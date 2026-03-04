-- init-replica.sql
-- Connect to primary with GTID auto-positioning

CHANGE MASTER TO
  MASTER_HOST     = 'mysql-primary',
  MASTER_PORT     = 3306,
  MASTER_USER     = 'repl',
  MASTER_PASSWORD = 'repl_pass',
  MASTER_AUTO_POSITION = 1;

START SLAVE;
