const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// Use require with default export for uuid
let uuidv4;
try {
  uuidv4 = require("uuid").v4;
} catch (e) {
  // Fallback UUID generation
  uuidv4 = () => {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (c) {
        var r = (Math.random() * 16) | 0,
          v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }
    );
  };
}

const dbPath = path.join(__dirname, "test-cases.db");

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database:", err);
  } else {
    console.log("Connected to SQLite database at:", dbPath);
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // Test Cases table
    db.run(
      `
      CREATE TABLE IF NOT EXISTS test_cases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        url TEXT,
        ado_story_id TEXT,
        ado_story_url TEXT,
        status TEXT DEFAULT 'draft',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT
      )
    `,
      (err) => {
        if (err) console.error("Error creating test_cases table:", err);
        else console.log("test_cases table ready");
      }
    );

    // ADO Story mapping table
    db.run(
      `
      CREATE TABLE IF NOT EXISTS ado_story_tests (
        id TEXT PRIMARY KEY,
        ado_story_id TEXT NOT NULL,
        ado_story_title TEXT,
        ado_story_number TEXT,
        test_case_id TEXT NOT NULL,
        linked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(test_case_id) REFERENCES test_cases(id),
        UNIQUE(ado_story_id, test_case_id)
      )
    `,
      (err) => {
        if (err) console.error("Error creating ado_story_tests table:", err);
        else console.log("ado_story_tests table ready");
      }
    );
  });
}

// Test Cases Operations
const TestCases = {
  // Create a new test case
  create: (name, code, url, metadata) => {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      const metadataJson = JSON.stringify(metadata || {});
      db.run(
        `INSERT INTO test_cases (id, name, code, url, metadata) VALUES (?, ?, ?, ?, ?)`,
        [id, name, code, url, metadataJson],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  },

  // Get test case by ID
  getById: (id) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM test_cases WHERE id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else {
          if (row && row.metadata) {
            row.metadata = JSON.parse(row.metadata);
          }
          resolve(row);
        }
      });
    });
  },

  // Get all test cases
  getAll: () => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM test_cases ORDER BY created_at DESC`,
        (err, rows) => {
          if (err) reject(err);
          else {
            rows = rows || [];
            rows.forEach((row) => {
              if (row.metadata) {
                row.metadata = JSON.parse(row.metadata);
              }
            });
            resolve(rows);
          }
        }
      );
    });
  },

  // Update test case
  update: (id, updates) => {
    return new Promise((resolve, reject) => {
      const fields = [];
      const values = [];
      for (const [key, value] of Object.entries(updates)) {
        if (key === "metadata") {
          fields.push(`${key} = ?`);
          values.push(JSON.stringify(value));
        } else {
          fields.push(`${key} = ?`);
          values.push(value);
        }
      }
      fields.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);

      const query = `UPDATE test_cases SET ${fields.join(", ")} WHERE id = ?`;
      db.run(query, values, function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  },

  // Delete test case
  delete: (id) => {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM test_cases WHERE id = ?`, [id], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  },

  // Get test cases for ADO story
  getByStoryId: (storyId) => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT tc.*, ast.ado_story_title, ast.ado_story_number FROM test_cases tc
         INNER JOIN ado_story_tests ast ON tc.id = ast.test_case_id
         WHERE ast.ado_story_id = ?
         ORDER BY tc.created_at DESC`,
        [storyId],
        (err, rows) => {
          if (err) reject(err);
          else {
            rows = rows || [];
            rows.forEach((row) => {
              if (row.metadata) {
                row.metadata = JSON.parse(row.metadata);
              }
            });
            resolve(rows);
          }
        }
      );
    });
  },

  // Get all test cases with story info
  getAllWithStories: () => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT tc.*, ast.ado_story_id, ast.ado_story_title, ast.ado_story_number
         FROM test_cases tc
         LEFT JOIN ado_story_tests ast ON tc.id = ast.test_case_id
         ORDER BY tc.created_at DESC`,
        (err, rows) => {
          if (err) reject(err);
          else {
            rows = rows || [];
            rows.forEach((row) => {
              if (row.metadata) {
                row.metadata = JSON.parse(row.metadata);
              }
            });
            resolve(rows);
          }
        }
      );
    });
  },
};

// ADO Story Test Mappings
const ADOStoryTests = {
  // Link test cases to ADO story
  linkTestCases: (storyId, testCaseIds, storyTitle = "", storyNumber = "") => {
    return new Promise(async (resolve, reject) => {
      try {
        // Delete existing links for this story
        await new Promise((res, rej) => {
          db.run(
            `DELETE FROM ado_story_tests WHERE ado_story_id = ?`,
            [storyId],
            (err) => {
              if (err) rej(err);
              else res();
            }
          );
        });

        // Insert new links
        const stmt = db.prepare(
          `INSERT INTO ado_story_tests (id, ado_story_id, ado_story_title, ado_story_number, test_case_id) VALUES (?, ?, ?, ?, ?)`
        );
        for (const testCaseId of testCaseIds) {
          stmt.run([uuidv4(), storyId, storyTitle, storyNumber, testCaseId]);
        }
        stmt.finalize((err) => {
          if (err) reject(err);
          else resolve(testCaseIds.length);
        });
      } catch (err) {
        reject(err);
      }
    });
  },

  // Get test case IDs linked to story
  getTestCaseIds: (storyId) => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT test_case_id FROM ado_story_tests WHERE ado_story_id = ?`,
        [storyId],
        (err, rows) => {
          if (err) reject(err);
          else resolve((rows || []).map((r) => r.test_case_id));
        }
      );
    });
  },
};

module.exports = {
  db,
  TestCases,
  ADOStoryTests,
};
