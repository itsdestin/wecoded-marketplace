-- WHY short codes: shared links carry an opaque code (youcoded.ai/?k7qm2x) instead of
-- readable utm_* labels that look like marketing tracking. Existing rows stay NULL until
-- the dashboard next registers them; old utm links keep resolving by source+campaign.
ALTER TABLE site_campaigns ADD COLUMN code TEXT CHECK(code IS NULL OR length(code)=6);
CREATE UNIQUE INDEX idx_site_campaigns_code ON site_campaigns(code);
