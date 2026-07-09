// The presenter's Zoom meeting role decides which interface they get. Only a host or
// co-host can read the participant list (getMeetingParticipants) and thus use the
// per-participant cost model; everyone else is limited to the Simple (attendees × rate)
// model. Zoom's getUserContext() returns `role` as a string whose exact casing/spelling
// has varied ('host', 'coHost', 'cohost', 'co-host'), so normalize before comparing.
//
// Safety default: an UNKNOWN or missing role is treated as NOT host-privileged — a user we
// can't confirm as host can't read participants anyway, so Simple-locking them is correct.
// (The local mock sets role:'host' explicitly so dev sees the full UI.)

export function isHostRole(role) {
  const norm = String(role ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, ''); // 'co-Host' / 'co_host' -> 'cohost'
  return norm === 'host' || norm === 'cohost';
}
