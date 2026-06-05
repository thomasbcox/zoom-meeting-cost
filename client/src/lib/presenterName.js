// Seed name for the presenter's editable name field.
//
// Inside real Zoom, adapter.init() returns `self` (from getUserContext). We seed
// the presenter's name from self.displayName so it reflects the actual signed-in
// user. When self (or a usable displayName) is unavailable — outside Zoom, in the
// mock prototype before edit, or when getUserContext failed — we fall back to a
// neutral default. The value stays user-editable after seeding.

export const DEFAULT_PRESENTER_NAME = 'Presenter';

export function seedPresenterName(self) {
  const name = self?.displayName;
  if (typeof name === 'string' && name.trim()) return name.trim();
  return DEFAULT_PRESENTER_NAME;
}
