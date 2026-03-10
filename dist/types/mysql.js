/**
 * MySQL Instance Types
 */
/**
 * Parse GTID string into structured format
 */
export function parseGTID(gtidString) {
    if (!gtidString)
        return [];
    const sets = [];
    const parts = gtidString.split(',');
    for (const part of parts) {
        const match = part.trim().match(/^([a-fA-F0-9-]+):(.+)$/);
        if (match && match[1] && match[2]) {
            const uuid = match[1];
            const intervals = [];
            const rangeParts = match[2].split(':');
            for (const range of rangeParts) {
                if (range.includes('-')) {
                    const parts = range.split('-').map(Number);
                    const start = parts[0] ?? 0;
                    const end = parts[1] ?? 0;
                    intervals.push([start, end]);
                }
                else {
                    const num = Number(range);
                    intervals.push([num, num]);
                }
            }
            sets.push({ uuid, intervals });
        }
    }
    return sets;
}
/**
 * Check if GTID A includes GTID B (A has all transactions B has)
 */
export function gtidIncludes(gtidA, gtidB) {
    if (!gtidB)
        return true;
    if (!gtidA)
        return false;
    const setsA = parseGTID(gtidA);
    const setsB = parseGTID(gtidB);
    for (const setB of setsB) {
        const setA = setsA.find(s => s.uuid === setB.uuid);
        if (!setA)
            return false;
        for (const [startB, endB] of setB.intervals) {
            let covered = false;
            for (const [startA, endA] of setA.intervals) {
                if (startA <= startB && endA >= endB) {
                    covered = true;
                    break;
                }
            }
            if (!covered)
                return false;
        }
    }
    return true;
}
//# sourceMappingURL=mysql.js.map