export type Profile = {
  id: string;
  nickname: string;
  bedtime: string;
  sleep_min: number;
  sleep_max: number;
  timezone: string;
  created_at: string;
};

export type Checkin = {
  id: string;
  user_id: string;
  day: string;
  bedtime: string;
  sleep_minutes: number;
  rested: boolean;
  on_time: boolean;
  unplugged: boolean;
  discipline: number;
  target_bedtime: string;
  target_min: number;
  target_max: number;
  created_at: string;
};

export type Friendship = {
  id: string;
  requester: string;
  recipient: string;
  status: 'pending' | 'accepted';
};

export type Snapshot = {
  me: Profile;
  profiles: Profile[];
  checkins: Checkin[];
  friendships: Friendship[];
};

export function localDay(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function complete(item: Checkin): boolean {
  return item.rested && item.on_time && item.unplugged;
}

export function stats(items: Checkin[], today: string) {
  const successful = new Set(items.filter(complete).map(item => item.day));
  const byDay = new Map(items.map(item => [item.day, item]));
  let cursor = today;
  // Today's incomplete check-in breaks a streak; an unreported day has until midnight.
  if (!byDay.has(today)) cursor = shiftDay(today, -1);
  let current = 0;
  while (successful.has(cursor)) {
    current++;
    cursor = shiftDay(cursor, -1);
  }
  let best = 0, run = 0, previous = '';
  for (const day of [...successful].sort()) {
    run = previous && shiftDay(previous, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  const start = shiftDay(today, -6);
  const week = [...successful].filter(day => day >= start && day <= today).length;
  return { current, best, week, total: successful.size };
}

export function hoursLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} ч${rest ? ` ${rest} мин` : ''}`;
}

export function dayLabel(day: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('ru-RU', options ?? { day: 'numeric', month: 'long' })
    .format(new Date(`${day}T12:00:00`));
}

export function friendIds(friendships: Friendship[], id: string): Set<string> {
  return new Set(friendships.filter(item => item.status === 'accepted' &&
    (item.requester === id || item.recipient === id))
    .map(item => item.requester === id ? item.recipient : item.requester));
}
