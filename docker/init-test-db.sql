-- Runs once when the compose Postgres volume is first created, so `npm test`
-- on the host can point at postgres://courier:courier@localhost:5432/courier_platform_test.
CREATE DATABASE courier_platform_test OWNER courier;
