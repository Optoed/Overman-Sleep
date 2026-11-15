import type { Snapshot } from './domain';

export async function loadSnapshot(_userId:string):Promise<Snapshot|null>{
  throw Error('legacy_online_disabled');
}

export function readableError(error: unknown): string {
  const value = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  if (/legacy_online_disabled/.test(value)) return 'Старый онлайн-кабинет отключён. Доступен локальный демо-режим.';
  if (/nickname_taken|duplicate key.*nickname|profiles_nickname/i.test(value)) return 'Этот ник уже занят. Попробуй другой.';
  if (/Invalid login credentials/i.test(value)) return 'Неверный email или пароль.';
  if (/Email not confirmed/i.test(value)) return 'Подтверди email по ссылке в письме.';
  if (/already registered/i.test(value)) return 'Этот email уже зарегистрирован. Войди в аккаунт.';
  if (/rate limit|too many requests/i.test(value)) return 'Слишком много попыток. Попробуй чуть позже.';
  if (/report_day_closed/i.test(value)) return 'Начался новый день. Обнови страницу и заполни новый отчёт.';
  if (/sleep_target_mismatch/i.test(value)) return 'Продолжительность сна не совпадает с твоей целью. Проверь первую отметку.';
  if (/schema cache|relation.*does not exist/i.test(value)) return 'База ещё не подготовлена. Нужно применить миграцию проекта.';
  if (/Failed to fetch|NetworkError|fetch failed/i.test(value)) return 'Нет связи. Проверь интернет и попробуй ещё раз — введённые данные сохранены в форме.';
  return 'Не удалось выполнить действие. Попробуй ещё раз.';
}
