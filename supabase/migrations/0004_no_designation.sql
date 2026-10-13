-- Practice-only reports ("limited in practice", no game status yet) are stored
-- as injury reports with this status. They never create alerts.
alter type injury_designation add value if not exists 'no_designation';
