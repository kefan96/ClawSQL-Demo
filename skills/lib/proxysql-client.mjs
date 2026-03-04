/**
 * ProxySQL Admin SQL Client
 *
 * Connects to ProxySQL's admin interface (port 6032) via mysql2
 * and provides functions for server/routing management.
 */

import mysql from 'mysql2/promise';

const PROXY_HOST = process.env.PROXYSQL_HOST     || 'proxysql';
const PROXY_PORT = process.env.PROXYSQL_PORT     || 6032;
const PROXY_USER = process.env.PROXYSQL_USER     || 'admin';
const PROXY_PASS = process.env.PROXYSQL_PASSWORD || 'admin_pass';

// Hostgroup constants
export const HG_WRITER = 10;
export const HG_READER = 20;
export const HG_BACKUP = 30;

let _pool = null;

function pool() {
  if (!_pool) {
    _pool = mysql.createPool({
      host: PROXY_HOST,
      port: Number(PROXY_PORT),
      user: PROXY_USER,
      password: PROXY_PASS,
      database: 'main',
      waitForConnections: true,
      connectionLimit: 3,
    });
  }
  return _pool;
}

async function query(sql) {
  const [rows] = await pool().query(sql);
  return rows;
}

async function execute(sql) {
  await pool().query(sql);
}

// ─── Server management ───

export async function getServers() {
  return query('SELECT * FROM mysql_servers ORDER BY hostgroup_id, hostname');
}

export async function getWriters() {
  return query(`SELECT * FROM mysql_servers WHERE hostgroup_id = ${HG_WRITER}`);
}

export async function getReaders() {
  return query(`SELECT * FROM mysql_servers WHERE hostgroup_id = ${HG_READER}`);
}

export async function addServer(hostgroup, hostname, port, weight = 1000, maxConn = 200) {
  await execute(
    `INSERT INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections)
     VALUES (${hostgroup}, '${hostname}', ${port}, ${weight}, ${maxConn})`
  );
  await loadServers();
}

export async function removeServer(hostname, port, hostgroup = null) {
  const hg = hostgroup !== null ? ` AND hostgroup_id = ${hostgroup}` : '';
  await execute(`DELETE FROM mysql_servers WHERE hostname='${hostname}' AND port=${port}${hg}`);
  await loadServers();
}

export async function setServerStatus(hostname, port, hostgroup, status) {
  await execute(
    `UPDATE mysql_servers SET status='${status}'
     WHERE hostname='${hostname}' AND port=${port} AND hostgroup_id=${hostgroup}`
  );
  await loadServers();
}

/**
 * Atomic writer switch:
 *   1. Remove old writer from HG_WRITER
 *   2. Add old writer to HG_READER
 *   3. Remove new writer from HG_READER
 *   4. Add new writer to HG_WRITER
 *   5. Load to runtime + save to disk
 */
export async function switchWriter(oldHost, oldPort, newHost, newPort) {
  // Step 1: remove old writer
  await execute(
    `DELETE FROM mysql_servers WHERE hostname='${oldHost}' AND port=${oldPort} AND hostgroup_id=${HG_WRITER}`
  );
  // Step 2: old writer becomes reader
  await execute(
    `REPLACE INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections)
     VALUES (${HG_READER}, '${oldHost}', ${oldPort}, 1000, 200)`
  );
  // Step 3: remove new writer from readers
  await execute(
    `DELETE FROM mysql_servers WHERE hostname='${newHost}' AND port=${newPort} AND hostgroup_id=${HG_READER}`
  );
  // Step 4: new writer
  await execute(
    `REPLACE INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections)
     VALUES (${HG_WRITER}, '${newHost}', ${newPort}, 1000, 200)`
  );
  await loadServers();
}

// ─── Connection pool stats ───

export async function getPoolStats() {
  return query('SELECT * FROM stats_mysql_connection_pool');
}

export async function getActiveConnections() {
  const stats = await getPoolStats();
  return stats.reduce((sum, s) => sum + s.ConnUsed, 0);
}

// ─── Query rules ───

export async function getQueryRules() {
  return query('SELECT * FROM mysql_query_rules ORDER BY rule_id');
}

// ─── Admin ───

export async function loadServers() {
  await execute('LOAD MYSQL SERVERS TO RUNTIME');
  await execute('SAVE MYSQL SERVERS TO DISK');
}

export async function loadQueryRules() {
  await execute('LOAD MYSQL QUERY RULES TO RUNTIME');
  await execute('SAVE MYSQL QUERY RULES TO DISK');
}

// ─── Health ───

export async function ping() {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function destroy() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
