use crate::links::{normalize_url, AddLinksResult, LinkPage, SavedLink};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

const SCHEMA_VERSION: i64 = 2;

#[derive(Serialize, Clone)]
pub struct Note {
    pub id: i64,
    pub content: String,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        fs::create_dir_all(&app_data_dir)?;

        let db_path = app_data_dir.join("notes.db");
        let conn = Connection::open(&db_path)?;

        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        migrate_schema(&conn)?;

        // Ensure at least one note exists
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
            .unwrap_or(0);

        if count == 0 {
            conn.execute("INSERT INTO notes (content, position) VALUES ('', 0)", [])?;
        }

        println!("Database initialized at: {:?}", db_path);

        Ok(Database {
            conn: Mutex::new(conn),
        })
    }

    pub fn list_links(&self, query: &str, offset: i64) -> Result<LinkPage, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let query = query.trim().to_lowercase();
        let filter =
            "instr(lower(url || ' ' || coalesce(title, '') || ' ' || coalesce(label, '')), ?1) > 0";
        let total = conn
            .query_row(
                &format!("SELECT count(*) FROM links WHERE {filter}"),
                [&query],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(&format!(
            "SELECT id, url, title, label, title_checked FROM links WHERE {filter} ORDER BY id DESC LIMIT 100 OFFSET ?2"
        )).map_err(|e| e.to_string())?;
        let links = stmt
            .query_map(params![query, offset.max(0)], link_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(LinkPage { links, total })
    }

    pub fn get_link(&self, id: i64) -> Result<SavedLink, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, url, title, label, title_checked FROM links WHERE id = ?1",
            [id],
            link_from_row,
        )
        .map_err(|e| e.to_string())
    }

    pub fn add_links(&self, text: &str) -> Result<AddLinksResult, String> {
        if text.len() > 1024 * 1024 || text.split_whitespace().count() > 1000 {
            return Err("Paste up to 1,000 URLs at a time.".into());
        }
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut result = AddLinksResult {
            added: Vec::new(),
            duplicates: 0,
            invalid: 0,
        };
        for value in text.split_whitespace() {
            let Ok(url) = normalize_url(value) else {
                result.invalid += 1;
                continue;
            };
            let inserted = tx
                .execute(
                    "INSERT INTO links (url) VALUES (?1) ON CONFLICT(url) DO NOTHING",
                    [&url],
                )
                .map_err(|e| e.to_string())?;
            if inserted == 0 {
                result.duplicates += 1;
                continue;
            }
            result.added.push(SavedLink {
                id: tx.last_insert_rowid(),
                url,
                title: None,
                label: None,
                title_checked: false,
            });
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }

    pub fn rename_link(&self, id: i64, label: &str) -> Result<(), String> {
        if label.chars().count() > 300 {
            return Err("Use a name of 300 characters or fewer.".into());
        }
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let label = label.trim();
        let changed = conn
            .execute(
                "UPDATE links SET label = ?1 WHERE id = ?2",
                params![if label.is_empty() { None } else { Some(label) }, id],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("Link no longer exists.".into());
        }
        Ok(())
    }

    pub fn delete_link(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM links WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn set_link_title(&self, id: i64, title: Option<&str>) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE links SET title = coalesce(?1, title), title_checked = 1 WHERE id = ?2",
            params![title, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn pending_link_titles(&self) -> Result<Vec<i64>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id FROM links WHERE title_checked = 0 ORDER BY id DESC LIMIT 100")
            .map_err(|e| e.to_string())?;
        let ids = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(ids)
    }

    pub fn fetch_link_titles_enabled(&self) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'fetch_link_titles'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(value.as_deref() != Some("0"))
    }

    pub fn set_fetch_link_titles(&self, enabled: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO app_settings (key, value) VALUES ('fetch_link_titles', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [if enabled { "1" } else { "0" }])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_note(&self, id: i64) -> Result<Note, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, content, position, created_at, updated_at FROM notes WHERE id = ?1",
            [id],
            |row| {
                Ok(Note {
                    id: row.get(0)?,
                    content: row.get(1)?,
                    position: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .map_err(|e| e.to_string())
    }

    pub fn list_notes(&self) -> Result<Vec<Note>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, content, position, created_at, updated_at FROM notes ORDER BY position ASC")
            .map_err(|e| e.to_string())?;

        let notes = stmt
            .query_map([], |row| {
                Ok(Note {
                    id: row.get(0)?,
                    content: row.get(1)?,
                    position: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(notes)
    }

    pub fn create_note(&self) -> Result<Note, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Get max position
        let max_pos: i64 = conn
            .query_row("SELECT COALESCE(MAX(position), -1) FROM notes", [], |row| {
                row.get(0)
            })
            .unwrap_or(-1);

        let new_pos = max_pos + 1;

        conn.execute(
            "INSERT INTO notes (content, position) VALUES ('', ?1)",
            rusqlite::params![new_pos],
        )
        .map_err(|e| e.to_string())?;

        let id = conn.last_insert_rowid();

        drop(conn); // release lock before calling get_note
        self.get_note(id)
    }

    pub fn save_note(&self, id: i64, content: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let updated = conn
            .execute(
                "UPDATE notes SET content = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                rusqlite::params![content, id],
            )
            .map_err(|e| e.to_string())?;
        if updated == 0 {
            return Err(format!("Note {id} does not exist."));
        }
        Ok(())
    }

    pub fn delete_note(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Get the position of the note being deleted
        let deleted_pos: i64 = conn
            .query_row("SELECT position FROM notes WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?;

        conn.execute("DELETE FROM notes WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;

        // Shift positions down for notes after the deleted one
        conn.execute(
            "UPDATE notes SET position = position - 1 WHERE position > ?1",
            [deleted_pos],
        )
        .map_err(|e| e.to_string())?;

        // Ensure at least one note always exists
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
            .unwrap_or(0);

        if count == 0 {
            conn.execute("INSERT INTO notes (content, position) VALUES ('', 0)", [])
                .map_err(|e| e.to_string())?;
        }

        Ok(())
    }
}

fn migrate_schema(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    let user_version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    if !notes_table_exists(conn)? {
        conn.execute_batch(
            "CREATE TABLE notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL DEFAULT '',
                position INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );",
        )?;
    }

    if user_version < 1 {
        if !notes_has_position(conn) {
            conn.execute_batch(
                "ALTER TABLE notes ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
                 UPDATE notes SET position = id - 1;",
            )?;
        }
    }

    if user_version < 2 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS links (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 url TEXT NOT NULL UNIQUE,
                 title TEXT,
                 label TEXT,
                 title_checked INTEGER NOT NULL DEFAULT 0,
                 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )?;
        tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        tx.commit()?;
    }

    Ok(())
}

fn link_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SavedLink> {
    Ok(SavedLink {
        id: row.get(0)?,
        url: row.get(1)?,
        title: row.get(2)?,
        label: row.get(3)?,
        title_checked: row.get(4)?,
    })
}

fn notes_table_exists(conn: &Connection) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='notes'",
        [],
        |row| Ok(row.get::<_, i64>(0)? > 0),
    )
}

fn notes_has_position(conn: &Connection) -> bool {
    conn.prepare("SELECT position FROM notes LIMIT 0").is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_app_data_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("noted-{name}-{unique}"))
    }

    #[test]
    fn links_are_separate_deduplicated_searchable_and_persistent() {
        let dir = temp_app_data_dir("links");
        let db = Database::new(dir.clone()).unwrap();
        let note = db.list_notes().unwrap()[0].clone();
        db.save_note(note.id, "my scratch note").unwrap();
        let result = db.add_links("https://Example.com https://example.com/ javascript:bad https://example.com/?q=1#part").unwrap();
        assert_eq!(result.added.len(), 2);
        assert_eq!(result.duplicates, 1);
        assert_eq!(result.invalid, 1);
        let id = result.added[0].id;
        db.set_link_title(id, Some("Fetched title")).unwrap();
        db.rename_link(id, "My own name").unwrap();
        db.set_link_title(id, Some("Updated title")).unwrap();
        let page = db.list_links("own", 0).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.links[0].label.as_deref(), Some("My own name"));
        assert_eq!(page.links[0].title.as_deref(), Some("Updated title"));
        assert_eq!(db.pending_link_titles().unwrap(), vec![result.added[1].id]);
        assert_eq!(db.list_notes().unwrap()[0].content, "my scratch note");
        assert!(db.fetch_link_titles_enabled().unwrap());
        db.set_fetch_link_titles(false).unwrap();
        drop(db);
        let db = Database::new(dir.clone()).unwrap();
        assert!(!db.fetch_link_titles_enabled().unwrap());
        assert_eq!(db.list_links("", 0).unwrap().total, 2);
        db.rename_link(id, " ").unwrap();
        assert!(db.get_link(id).unwrap().label.is_none());
        db.set_link_title(id, None).unwrap();
        assert_eq!(
            db.get_link(id).unwrap().title.as_deref(),
            Some("Updated title")
        );
        db.delete_link(id).unwrap();
        // A late fetch must not recreate a deleted link.
        db.set_link_title(id, Some("Late title")).unwrap();
        assert_eq!(db.list_links("", 0).unwrap().total, 1);
        assert_eq!(db.list_notes().unwrap().len(), 1);
        drop(db);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn links_are_paged_and_existing_v1_notes_survive_migration() {
        let dir = temp_app_data_dir("links-migration");
        fs::create_dir_all(&dir).unwrap();
        {
            let conn = Connection::open(dir.join("notes.db")).unwrap();
            conn.execute_batch("CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
                INSERT INTO notes (content, position) VALUES ('existing', 0); PRAGMA user_version = 1;").unwrap();
        }
        let db = Database::new(dir.clone()).unwrap();
        assert_eq!(db.list_notes().unwrap()[0].content, "existing");
        let text = (0..105)
            .map(|i| format!("https://example.com/{i}"))
            .collect::<Vec<_>>()
            .join("\n");
        db.add_links(&text).unwrap();
        let first = db.list_links("", 0).unwrap();
        let next = db.list_links("", 100).unwrap();
        assert_eq!(first.total, 105);
        assert_eq!(first.links.len(), 100);
        assert_eq!(next.links.len(), 5);
        assert!(first.links[0].id > next.links[0].id);
        assert!(db.add_links(&"x ".repeat(1001)).is_err());
        drop(db);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn fresh_database_starts_with_one_empty_note() {
        let dir = temp_app_data_dir("fresh");
        let db = Database::new(dir.clone()).expect("database should initialize");

        let notes = db.list_notes().expect("notes should list");
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].content, "");
        assert_eq!(notes[0].position, 0);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn create_and_delete_notes_preserves_contiguous_positions() {
        let dir = temp_app_data_dir("positions");
        let db = Database::new(dir.clone()).expect("database should initialize");

        let first_id = db.list_notes().expect("notes should list")[0].id;
        let second = db.create_note().expect("second note should create");
        let third = db.create_note().expect("third note should create");

        db.save_note(second.id, "middle").expect("note should save");
        db.delete_note(first_id).expect("first note should delete");

        let notes = db.list_notes().expect("notes should list");
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].id, second.id);
        assert_eq!(notes[0].position, 0);
        assert_eq!(notes[0].content, "middle");
        assert_eq!(notes[1].id, third.id);
        assert_eq!(notes[1].position, 1);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn save_missing_note_returns_error() {
        let dir = temp_app_data_dir("missing-save");
        let db = Database::new(dir.clone()).expect("database should initialize");

        let error = db
            .save_note(999_999, "missing")
            .expect_err("saving a missing note should fail");
        assert!(error.contains("does not exist"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn old_schema_without_position_is_migrated() {
        let dir = temp_app_data_dir("migration");
        fs::create_dir_all(&dir).expect("temp dir should create");
        let old_db_path = dir.join("notes.db");
        {
            let conn = Connection::open(&old_db_path).expect("old db should open");
            conn.execute_batch(
                "CREATE TABLE notes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    content TEXT NOT NULL DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                INSERT INTO notes (content) VALUES ('first'), ('second');",
            )
            .expect("old schema should seed");
        }

        let db = Database::new(dir.clone()).expect("database should migrate");
        let notes = db.list_notes().expect("notes should list");
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].content, "first");
        assert_eq!(notes[0].position, 0);
        assert_eq!(notes[1].content, "second");
        assert_eq!(notes[1].position, 1);

        let conn = db.conn.lock().expect("database lock should be available");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("schema version should read");
        assert_eq!(version, SCHEMA_VERSION);
        drop(conn);

        let _ = fs::remove_dir_all(dir);
    }
}
