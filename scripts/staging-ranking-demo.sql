-- Staging-only demo data for visually checking the rankings page.
-- All synthetic records use the rank-demo- prefix so they can be identified later.

INSERT OR IGNORE INTO users (id, user_id, display_name, created_at_ms, updated_at_ms)
VALUES
    ('rank-demo-user-1', 'rank_demo_1', 'デモプレイヤーA', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    ('rank-demo-user-2', 'rank_demo_2', 'デモプレイヤーB', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    ('rank-demo-user-3', 'rank_demo_3', 'デモプレイヤーC', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

INSERT OR IGNORE INTO game_sessions (
    id, owner_user_id, name, join_code, player_count, status, rules_json,
    state_version, created_at_ms, updated_at_ms, closed_at_ms
)
VALUES (
    'rank-demo-session-20261106',
    '720f9494-6609-4021-be16-f955fdbf8062',
    'ランキング表示確認用',
    'RANKDEMO',
    4,
    'closed',
    '{"playerCount":4,"baseScore":25000,"scoreMultiplierBasisPoints":1000,"rankBonusesMilli":{"1":20000,"2":10000,"3":0,"4":-30000}}',
    9,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 86400000,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
);

INSERT OR IGNORE INTO session_members (session_id, user_id, seat_index, joined_at_ms)
VALUES
    ('rank-demo-session-20261106', '720f9494-6609-4021-be16-f955fdbf8062', 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 86400000),
    ('rank-demo-session-20261106', 'rank-demo-user-1', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 86400000),
    ('rank-demo-session-20261106', 'rank-demo-user-2', 2, CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 86400000),
    ('rank-demo-session-20261106', 'rank-demo-user-3', 3, CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 86400000);

WITH game_numbers(ordinal) AS (
    VALUES (1), (2), (3), (4), (5), (6), (7), (8)
)
INSERT OR IGNORE INTO games (
    id, session_id, ordinal, recorded_by_user_id, played_at_ms, created_at_ms
)
SELECT
    printf('rank-demo-game-%02d', ordinal),
    'rank-demo-session-20261106',
    ordinal,
    '720f9494-6609-4021-be16-f955fdbf8062',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000 - ((9 - ordinal) * 3600000),
    CAST(strftime('%s', 'now') AS INTEGER) * 1000 - ((9 - ordinal) * 3600000)
FROM game_numbers;

WITH placements(game_no, user_id, rank) AS (
    VALUES
        (1, '720f9494-6609-4021-be16-f955fdbf8062', 1), (1, 'rank-demo-user-1', 2), (1, 'rank-demo-user-2', 3), (1, 'rank-demo-user-3', 4),
        (2, '720f9494-6609-4021-be16-f955fdbf8062', 1), (2, 'rank-demo-user-1', 3), (2, 'rank-demo-user-2', 2), (2, 'rank-demo-user-3', 4),
        (3, '720f9494-6609-4021-be16-f955fdbf8062', 2), (3, 'rank-demo-user-1', 1), (3, 'rank-demo-user-2', 3), (3, 'rank-demo-user-3', 4),
        (4, '720f9494-6609-4021-be16-f955fdbf8062', 1), (4, 'rank-demo-user-1', 2), (4, 'rank-demo-user-2', 4), (4, 'rank-demo-user-3', 3),
        (5, '720f9494-6609-4021-be16-f955fdbf8062', 3), (5, 'rank-demo-user-1', 1), (5, 'rank-demo-user-2', 2), (5, 'rank-demo-user-3', 4),
        (6, '720f9494-6609-4021-be16-f955fdbf8062', 1), (6, 'rank-demo-user-1', 4), (6, 'rank-demo-user-2', 2), (6, 'rank-demo-user-3', 3),
        (7, '720f9494-6609-4021-be16-f955fdbf8062', 2), (7, 'rank-demo-user-1', 3), (7, 'rank-demo-user-2', 1), (7, 'rank-demo-user-3', 4),
        (8, '720f9494-6609-4021-be16-f955fdbf8062', 1), (8, 'rank-demo-user-1', 2), (8, 'rank-demo-user-2', 3), (8, 'rank-demo-user-3', 4)
),
rank_values(rank, final_score, score_difference, score_points_milli, rank_bonus_milli, points_milli) AS (
    VALUES
        (1, 30000, 5000, 500000, 20000, 520000),
        (2, 26000, 1000, 100000, 10000, 110000),
        (3, 24000, -1000, -100000, 0, -100000),
        (4, 20000, -5000, -500000, -30000, -530000)
)
INSERT OR IGNORE INTO game_results (
    game_id, user_id, final_score, rank, score_difference,
    score_points_milli, rank_bonus_milli, points_milli, created_at_ms
)
SELECT
    printf('rank-demo-game-%02d', placements.game_no),
    placements.user_id,
    rank_values.final_score,
    placements.rank,
    rank_values.score_difference,
    rank_values.score_points_milli,
    rank_values.rank_bonus_milli,
    rank_values.points_milli,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000 - ((9 - placements.game_no) * 3600000)
FROM placements
INNER JOIN rank_values ON rank_values.rank = placements.rank;
