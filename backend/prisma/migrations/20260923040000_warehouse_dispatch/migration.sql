ALTER TABLE wms_portal_sessions DROP CONSTRAINT wms_portal_sessions_station_check;
ALTER TABLE wms_portal_sessions ADD CONSTRAINT wms_portal_sessions_station_check CHECK (station IN ('picker','packer','dispatcher'));
