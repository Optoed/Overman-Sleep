import { localDay, shiftDay, type Snapshot, type Checkin, type Profile } from './domain';

export function demoSnapshot(): Snapshot {
  const today = localDay('Europe/Moscow');
  const names = ['overman', 'nikita', 'polina', 'alex.m', 'masha', 'kirill'];
  const profiles: Profile[] = names.map((nickname, i) => ({
    id: `demo-${i}`, nickname, bedtime: ['23:00','22:30','23:30','23:00','22:00','00:00'][i],
    sleep_min: 480, sleep_max: 540, timezone: 'Europe/Moscow', created_at: `${shiftDay(today, -30)}T00:00:00Z`,
  }));
  const checkins: Checkin[] = [];
  profiles.forEach((profile, i) => {
    const length = [7, 12, 5, 3, 9, 2][i];
    for (let n = i === 0 ? 1 : 0; n < length + (i === 0 ? 1 : 0); n++) {
      const day = shiftDay(today, -n);
      checkins.push({ id: `${profile.id}-${day}`, user_id: profile.id, day,
        bedtime: profile.bedtime, sleep_minutes: 480 + (i % 3) * 15,
        rested: true, on_time: true, unplugged: true, discipline: i % 2 ? 4 : 5,
        target_bedtime: profile.bedtime, target_min: 480, target_max: 540, created_at: `${day}T08:00:00Z`,
      });
    }
  });
  return { me: profiles[0], profiles, checkins, friendships: [
    { id: 'demo-friend-1', requester: profiles[0].id, recipient: profiles[1].id, status: 'accepted' },
    { id: 'demo-friend-2', requester: profiles[2].id, recipient: profiles[0].id, status: 'pending' },
  ] };
}
