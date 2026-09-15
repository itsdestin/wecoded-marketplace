-- Website analytics persists only an HMAC-derived page key, never the raw nonce.
CREATE TABLE site_campaigns (id INTEGER PRIMARY KEY, source TEXT NOT NULL, campaign TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(source,campaign), CHECK(length(source) BETWEEN 1 AND 160), CHECK(length(campaign) BETWEEN 1 AND 160));
CREATE TABLE site_journeys (page_key TEXT PRIMARY KEY CHECK(length(page_key)=64), day TEXT NOT NULL, campaign_id INTEGER NOT NULL DEFAULT 0, referrer_domain TEXT NOT NULL DEFAULT '', expires_at INTEGER NOT NULL, update_day TEXT NOT NULL, instructions INTEGER NOT NULL DEFAULT 0 CHECK(instructions IN(0,1)), windows INTEGER NOT NULL DEFAULT 0 CHECK(windows>=0), macos INTEGER NOT NULL DEFAULT 0 CHECK(macos>=0), linux INTEGER NOT NULL DEFAULT 0 CHECK(linux>=0), android INTEGER NOT NULL DEFAULT 0 CHECK(android>=0), CHECK(windows+macos+linux+android<=100));
CREATE INDEX idx_site_journeys_expiry ON site_journeys(expires_at);
CREATE TABLE site_daily (day TEXT NOT NULL,campaign_id INTEGER NOT NULL DEFAULT 0,referrer_domain TEXT NOT NULL DEFAULT '',visits INTEGER NOT NULL DEFAULT 0,instructions INTEGER NOT NULL DEFAULT 0,clicked_visits INTEGER NOT NULL DEFAULT 0,windows INTEGER NOT NULL DEFAULT 0,macos INTEGER NOT NULL DEFAULT 0,linux INTEGER NOT NULL DEFAULT 0,android INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,campaign_id,referrer_domain));
CREATE TABLE site_daily_domains (day TEXT NOT NULL,domain TEXT NOT NULL,PRIMARY KEY(day,domain));
CREATE TABLE site_daily_budget (day TEXT PRIMARY KEY,starts INTEGER NOT NULL DEFAULT 0,changes INTEGER NOT NULL DEFAULT 0,registrations INTEGER NOT NULL DEFAULT 0,cells INTEGER NOT NULL DEFAULT 0);
CREATE TABLE site_analytics_health (id INTEGER PRIMARY KEY CHECK(id=1), last_sweep_at INTEGER, last_sweep_ok INTEGER, last_sweep_error TEXT, collection_started_day TEXT);
-- WHY quotas are in triggers: D1 serializes the reservation with the state mutation.
-- WHY BEFORE INSERT also runs for INSERT OR IGNORE retries: only a new page may reserve quota.
CREATE TRIGGER site_journey_limits BEFORE INSERT ON site_journeys WHEN NOT EXISTS(SELECT 1 FROM site_journeys WHERE page_key=NEW.page_key) BEGIN
 SELECT CASE WHEN COALESCE((SELECT starts FROM site_daily_budget WHERE day=NEW.day),0)>=10000 THEN RAISE(ABORT,'site_start_limit') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM site_daily WHERE day=NEW.day AND campaign_id=NEW.campaign_id AND referrer_domain=NEW.referrer_domain) AND COALESCE((SELECT cells FROM site_daily_budget WHERE day=NEW.day),0)>=1000 THEN RAISE(ABORT,'site_cell_limit') END;
 INSERT INTO site_daily_budget(day,starts,cells) VALUES(NEW.day,1,CASE WHEN EXISTS(SELECT 1 FROM site_daily WHERE day=NEW.day AND campaign_id=NEW.campaign_id AND referrer_domain=NEW.referrer_domain) THEN 0 ELSE 1 END) ON CONFLICT(day) DO UPDATE SET starts=starts+1,cells=cells+excluded.cells;
END;
CREATE TRIGGER site_domain_limits BEFORE INSERT ON site_daily_domains WHEN NEW.domain<>'' AND NEW.domain<>'Other referring sites' AND NOT EXISTS(SELECT 1 FROM site_daily_domains WHERE day=NEW.day AND domain=NEW.domain) AND (SELECT count(*) FROM site_daily_domains WHERE day=NEW.day AND domain<>'' AND domain<>'Other referring sites')>=128 BEGIN
 -- WHY IGNORE lets the caller deterministically map an over-cap domain to Other.
 SELECT RAISE(IGNORE);
END;
-- WHY an existing (source,campaign) is a retry, even on another day or at the daily cap.
CREATE TRIGGER site_campaign_daily_limit BEFORE INSERT ON site_campaigns WHEN NOT EXISTS(SELECT 1 FROM site_campaigns WHERE source=NEW.source AND campaign=NEW.campaign) BEGIN
 SELECT CASE WHEN COALESCE((SELECT registrations FROM site_daily_budget WHERE day=date(NEW.created_at,'unixepoch')),0)>=30 THEN RAISE(ABORT,'site_registration_limit') END;
 INSERT INTO site_daily_budget(day,registrations) VALUES(date(NEW.created_at,'unixepoch'),1) ON CONFLICT(day) DO UPDATE SET registrations=registrations+1;
END;
CREATE TRIGGER site_journey_insert AFTER INSERT ON site_journeys BEGIN
 -- Start-date metadata is not a visitor trail; it distinguishes pre-collection days from zero traffic.
 INSERT INTO site_analytics_health(id,collection_started_day) VALUES(1,NEW.day) ON CONFLICT(id) DO UPDATE SET collection_started_day=COALESCE(collection_started_day,excluded.collection_started_day);
 INSERT INTO site_daily(day,campaign_id,referrer_domain,visits,instructions,clicked_visits,windows,macos,linux,android) VALUES(NEW.day,NEW.campaign_id,NEW.referrer_domain,1,NEW.instructions,CASE WHEN NEW.windows+NEW.macos+NEW.linux+NEW.android>0 THEN 1 ELSE 0 END,NEW.windows,NEW.macos,NEW.linux,NEW.android) ON CONFLICT(day,campaign_id,referrer_domain) DO UPDATE SET visits=visits+1,instructions=instructions+excluded.instructions,clicked_visits=clicked_visits+excluded.clicked_visits,windows=windows+excluded.windows,macos=macos+excluded.macos,linux=linux+excluded.linux,android=android+excluded.android;
END;
CREATE TRIGGER site_journey_change_limit BEFORE UPDATE OF instructions,windows,macos,linux,android ON site_journeys WHEN NEW.instructions>OLD.instructions OR NEW.windows>OLD.windows OR NEW.macos>OLD.macos OR NEW.linux>OLD.linux OR NEW.android>OLD.android BEGIN
 SELECT CASE WHEN COALESCE((SELECT changes FROM site_daily_budget WHERE day=NEW.update_day),0)>=50000 THEN RAISE(ABORT,'site_change_limit') END;
 INSERT INTO site_daily_budget(day,changes) VALUES(NEW.update_day,1) ON CONFLICT(day) DO UPDATE SET changes=changes+1;
END;
CREATE TRIGGER site_journey_update AFTER UPDATE OF instructions,windows,macos,linux,android ON site_journeys WHEN NEW.instructions>OLD.instructions OR NEW.windows>OLD.windows OR NEW.macos>OLD.macos OR NEW.linux>OLD.linux OR NEW.android>OLD.android BEGIN
 UPDATE site_daily SET instructions=instructions+(NEW.instructions-OLD.instructions),clicked_visits=clicked_visits+CASE WHEN OLD.windows+OLD.macos+OLD.linux+OLD.android=0 AND NEW.windows+NEW.macos+NEW.linux+NEW.android>0 THEN 1 ELSE 0 END,windows=windows+(NEW.windows-OLD.windows),macos=macos+(NEW.macos-OLD.macos),linux=linux+(NEW.linux-OLD.linux),android=android+(NEW.android-OLD.android) WHERE day=NEW.day AND campaign_id=NEW.campaign_id AND referrer_domain=NEW.referrer_domain;
END;
