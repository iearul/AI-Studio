-- A development restart used to replay external work, which could leave more
-- than one active row for a shot. Preserve the newest row and close older work
-- before adding the database-level invariant.
UPDATE generation_attempts
SET status = 'failed',
    error_message = 'Superseded while applying the active-job safety migration.',
    error_details_json = '{"code":"duplicate_active_job","recoverable":true}',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (
  SELECT older.attempt_id
  FROM generation_jobs AS older
  JOIN generation_jobs AS newer
    ON newer.shot_id = older.shot_id
   AND newer.status IN ('queued', 'preparing', 'generating', 'downloading')
   AND (newer.created_at > older.created_at OR
        (newer.created_at = older.created_at AND newer.id > older.id))
  WHERE older.status IN ('queued', 'preparing', 'generating', 'downloading')
);

UPDATE generation_jobs
SET status = 'failed',
    error_message = 'Superseded while applying the active-job safety migration.',
    error_details_json = '{"code":"duplicate_active_job","recoverable":true}',
    completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (
  SELECT older.id
  FROM generation_jobs AS older
  JOIN generation_jobs AS newer
    ON newer.shot_id = older.shot_id
   AND newer.status IN ('queued', 'preparing', 'generating', 'downloading')
   AND (newer.created_at > older.created_at OR
        (newer.created_at = older.created_at AND newer.id > older.id))
  WHERE older.status IN ('queued', 'preparing', 'generating', 'downloading')
);

CREATE UNIQUE INDEX generation_jobs_one_active_shot_idx
  ON generation_jobs(shot_id)
  WHERE status IN ('queued', 'preparing', 'generating', 'downloading');
