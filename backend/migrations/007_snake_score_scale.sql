-- The restored faithful Snake uses 10 points per normal food instead of the
-- previous reducer's 1 point. Rescale historical Snake bests once so the
-- existing leaderboard remains comparable to the new scoring unit.
UPDATE arcade_scores
SET score = score * 10,
    updated_at = now()
WHERE game = 'snake';
