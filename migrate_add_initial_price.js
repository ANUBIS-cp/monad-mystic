const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('/home/rayzelnoblesse5/monad-mystic/prophecies.db');

db.serialize(() => {
    // Try to add column - will fail silently if already exists
    db.run("ALTER TABLE prophecies ADD COLUMN initialPrice REAL", (err) => {
        if (err && !err.message.includes('duplicate column')) {
            console.error('Migration error:', err.message);
        } else {
            console.log('✓ Added initialPrice column');
        }
        db.close();
    });
});
