use reqwest::{header, redirect::Policy, Url};
use scraper::{Html, Selector};
use serde::Serialize;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
use tokio::sync::Semaphore;

const MAX_HTML_BYTES: usize = 512 * 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Clone, Serialize, Debug)]
pub struct SavedLink {
    pub id: i64,
    pub url: String,
    pub title: Option<String>,
    pub label: Option<String>,
    pub title_checked: bool,
}

#[derive(Serialize)]
pub struct LinkPage {
    pub links: Vec<SavedLink>,
    pub total: i64,
}

#[derive(Serialize)]
pub struct AddLinksResult {
    pub added: Vec<SavedLink>,
    pub duplicates: usize,
    pub invalid: usize,
}

pub fn normalize_url(value: &str) -> Result<String, String> {
    if value.len() > 8192 || value.chars().any(char::is_whitespace) {
        return Err("URL is too long or contains whitespace.".into());
    }
    let url = Url::parse(value).map_err(|_| "Invalid URL.")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Use an HTTP or HTTPS URL without embedded credentials.".into());
    }
    Ok(url.into())
}

pub struct TitleFetcher {
    slots: Semaphore,
}

impl TitleFetcher {
    pub fn new() -> Self {
        Self {
            slots: Semaphore::new(2),
        }
    }

    pub async fn fetch(&self, url: &str) -> Result<String, String> {
        let _slot = self.slots.acquire().await.map_err(|e| e.to_string())?;
        tokio::time::timeout(FETCH_TIMEOUT, fetch_title(url, is_public_ip))
            .await
            .map_err(|_| "Page title request timed out.".to_string())?
    }
}

async fn fetch_title(value: &str, allowed_ip: fn(IpAddr) -> bool) -> Result<String, String> {
    let mut url = Url::parse(&normalize_url(value)?).map_err(|e| e.to_string())?;
    for _ in 0..=3 {
        let host = url.host_str().ok_or("URL has no host.")?;
        let port = url.port_or_known_default().ok_or("URL has no port.")?;
        let addresses: Vec<SocketAddr> =
            tokio::net::lookup_host((host.trim_matches(['[', ']']), port))
                .await
                .map_err(|_| "Could not resolve the website.")?
                .collect();
        if addresses.is_empty() || addresses.iter().any(|addr| !allowed_ip(addr.ip())) {
            return Err("Automatic titles are only fetched from public websites.".into());
        }

        // Pin the validated DNS answers and disable proxies so redirects and
        // DNS rebinding cannot turn a public URL into a local network request.
        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .no_proxy()
            .resolve_to_addrs(host, &addresses)
            .timeout(FETCH_TIMEOUT)
            .user_agent("noted link titles")
            .build()
            .map_err(|e| e.to_string())?;
        let mut response = client
            .get(url.clone())
            .send()
            .await
            .map_err(|_| "Could not download the page title.")?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("Redirect has no valid destination.")?;
            let next = url.join(location).map_err(|_| "Invalid redirect.")?;
            url = Url::parse(&normalize_url(next.as_str())?).map_err(|e| e.to_string())?;
            continue;
        }
        response
            .error_for_status_ref()
            .map_err(|_| "Website returned an error.")?;
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if !matches!(content_type.as_str(), "text/html" | "application/xhtml+xml") {
            return Err("This link is not an HTML page.".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Could not read the page.")?
        {
            let remaining = MAX_HTML_BYTES - bytes.len();
            bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
            if bytes.len() == MAX_HTML_BYTES
                || bytes
                    .windows(7)
                    .any(|window| window.eq_ignore_ascii_case(b"</head>"))
            {
                break;
            }
        }
        return extract_title(&String::from_utf8_lossy(&bytes))
            .ok_or_else(|| "The page has no usable title.".into());
    }
    Err("Website redirected too many times.".into())
}

fn clean_title(value: &str) -> Option<String> {
    let cleaned: String = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(300)
        .collect();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

fn extract_title(html: &str) -> Option<String> {
    let document = Html::parse_document(html);
    let meta = Selector::parse("meta").expect("static selector");
    for element in document.select(&meta) {
        if element
            .value()
            .attr("property")
            .is_some_and(|v| v.eq_ignore_ascii_case("og:title"))
        {
            if let Some(title) = element.value().attr("content").and_then(clean_title) {
                return Some(title);
            }
        }
    }
    let title = Selector::parse("title").expect("static selector");
    document
        .select(&title)
        .find_map(|element| clean_title(&element.text().collect::<String>()))
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_broadcast()
                && !ip.is_documentation()
                && !ip.is_multicast()
                && a != 0
                && a < 240
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 192 && b == 0 && c == 0)
                && !(a == 198 && (b == 18 || b == 19))
        }
        IpAddr::V6(ip) => {
            if let Some(ip) = ip.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(ip));
            }
            let segments = ip.segments();
            // Accept global unicast only, excluding special-use and documentation ranges.
            (segments[0] & 0xe000) == 0x2000
                && !(segments[0] == 0x2001 && segments[1] < 0x200)
                && !(segments[0] == 0x2001 && segments[1] == 0xdb8)
                && segments[0] != 0x2002
                && !(segments[0] == 0x3fff && segments[1] < 0x1000)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    fn serve(responses: Vec<String>) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = [0; 4096];
                let _ = stream.read(&mut request);
                let _ = stream.write_all(response.as_bytes());
            }
        });
        format!("http://{address}/")
    }

    fn html_response(body: &str) -> String {
        format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    }

    #[test]
    fn title_fetch_follows_relative_redirects_and_reads_a_bounded_head() {
        let page = format!(
            "<head><title>Fetched &amp; cached</title></head>{}",
            "x".repeat(MAX_HTML_BYTES * 2)
        );
        let url = serve(vec![
            "HTTP/1.1 302 Found\r\nLocation: /page\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
            html_response(&page)
        ]);
        let title = test_runtime()
            .block_on(fetch_title(&url, |_| true))
            .unwrap();
        assert_eq!(title, "Fetched & cached");
    }

    #[test]
    fn title_fetch_rejects_non_html_and_revalidates_redirect_destinations() {
        let url = serve(vec!["HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()]);
        assert!(test_runtime()
            .block_on(fetch_title(&url, |_| true))
            .unwrap_err()
            .contains("not an HTML"));
        let url = serve(vec!["HTTP/1.1 302 Found\r\nLocation: http://127.0.0.2/secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()]);
        let error = test_runtime()
            .block_on(fetch_title(&url, |ip| {
                ip == "127.0.0.1".parse::<IpAddr>().unwrap()
            }))
            .unwrap_err();
        assert!(error.contains("public websites"));
    }

    #[test]
    fn title_fetch_caps_redirects_and_never_reads_past_the_html_limit() {
        let redirect = "HTTP/1.1 302 Found\r\nLocation: /again\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string();
        let url = serve(vec![redirect; 4]);
        assert!(test_runtime()
            .block_on(fetch_title(&url, |_| true))
            .unwrap_err()
            .contains("too many"));
        let body = format!("{}<title>Too late</title>", " ".repeat(MAX_HTML_BYTES));
        let url = serve(vec![html_response(&body)]);
        assert!(test_runtime()
            .block_on(fetch_title(&url, |_| true))
            .is_err());
    }

    #[test]
    fn urls_are_normalized_without_losing_query_or_fragment() {
        assert_eq!(
            normalize_url("HTTPS://Example.COM:443/a?q=1#part").unwrap(),
            "https://example.com/a?q=1#part"
        );
        for invalid in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "https://user:secret@example.com",
            "https://exa mple.com",
            "not a link",
        ] {
            assert!(normalize_url(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn titles_prefer_open_graph_and_decode_entities_as_text() {
        let html = r#"<head><title>Fallback</title><meta property="og:title" content="  Fish &amp; chips&#10; &lt;script&gt; "></head>"#;
        assert_eq!(
            extract_title(html).as_deref(),
            Some("Fish & chips <script>")
        );
        assert_eq!(
            extract_title("<title> Plain\n title </title>").as_deref(),
            Some("Plain title")
        );
        assert_eq!(
            extract_title("<meta property='og:title' content=' '><title>Fallback</title>")
                .as_deref(),
            Some("Fallback")
        );
        assert!(extract_title("<p>No title</p>").is_none());
        assert_eq!(clean_title(&"x".repeat(500)).unwrap().len(), 300);
    }

    #[test]
    fn metadata_blocks_local_and_special_use_addresses() {
        for value in [
            "0.0.0.0",
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "192.0.0.1",
            "192.0.2.1",
            "198.18.0.1",
            "224.0.0.1",
            "255.255.255.255",
            "::",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
            "2002:7f00:1::",
            "3fff::1",
        ] {
            assert!(!is_public_ip(value.parse().unwrap()), "{value}");
        }
        assert!(is_public_ip("8.8.8.8".parse().unwrap()));
        assert!(is_public_ip("2606:4700:4700::1111".parse().unwrap()));
    }
}
