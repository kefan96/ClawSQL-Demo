-- init-primary.sql
-- Users for replication, orchestrator, proxysql monitor, and application

CREATE USER IF NOT EXISTS 'repl'@'%' IDENTIFIED BY 'repl_pass';
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';

CREATE USER IF NOT EXISTS 'orchestrator'@'%' IDENTIFIED BY 'orch_pass';
GRANT SUPER, PROCESS, REPLICATION SLAVE, REPLICATION CLIENT, RELOAD ON *.* TO 'orchestrator'@'%';
GRANT SELECT ON mysql.slave_master_info TO 'orchestrator'@'%';

CREATE USER IF NOT EXISTS 'proxysql_mon'@'%' IDENTIFIED BY 'mon_pass';
GRANT REPLICATION CLIENT ON *.* TO 'proxysql_mon'@'%';

CREATE USER IF NOT EXISTS 'app'@'%' IDENTIFIED BY 'app_pass';
GRANT ALL PRIVILEGES ON *.* TO 'app'@'%';

FLUSH PRIVILEGES;

-- Demo database
CREATE DATABASE IF NOT EXISTS demo;
USE demo;
CREATE TABLE IF NOT EXISTS ping (id INT AUTO_INCREMENT PRIMARY KEY, ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP, src VARCHAR(64));
INSERT INTO ping (src) VALUES ('init-primary');
