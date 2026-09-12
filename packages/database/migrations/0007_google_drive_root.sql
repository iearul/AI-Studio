INSERT INTO settings (key, value_json, updated_at)
VALUES ('googleDriveFolder', '"OSPO"', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(key) DO UPDATE SET
  value_json = excluded.value_json,
  updated_at = excluded.updated_at;
