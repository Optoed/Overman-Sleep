import './dom';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OvermanApp from '../components/overman-app';

afterEach(cleanup);

test('quest saves, restores streak after correction, and appears in history', async () => {
  const user = userEvent.setup();
  render(<OvermanApp/>);
  assert.ok(await screen.findByText(/Демо-режим/));
  await user.click(screen.getByRole('checkbox', { name: 'Я выспался' }));
  await user.click(screen.getByRole('checkbox', { name: 'Я лёг вовремя' }));
  await user.click(screen.getByRole('checkbox', { name: 'Я отключился от лишнего' }));
  await user.click(screen.getByRole('button', { name: /Сохранить мой день/ }));
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Отчёт сохранён' }).hasAttribute('disabled')));
  assert.ok(screen.getByText('08'));
  await user.click(screen.getByRole('checkbox', { name: 'Я выспался' }));
  await user.click(screen.getByRole('button', { name: /Обновить отчёт/ }));
  await waitFor(() => assert.ok(screen.getByText('00')));
  await user.click(screen.getByRole('checkbox', { name: 'Я выспался' }));
  await user.click(screen.getByRole('button', { name: /Обновить отчёт/ }));
  await waitFor(() => assert.ok(screen.getByText('08')));
  await user.click(screen.getByRole('button', { name: 'Мой профиль' }));
  assert.ok(screen.getByText('История дисциплины'));
  assert.equal(screen.getAllByText('Слово сдержано').length, 8);
});

test('friend request can be accepted, friend list filtered, and nickname edited', async () => {
  const user = userEvent.setup(); render(<OvermanApp/>);
  await screen.findByText(/Демо-режим/);
  await user.click(screen.getAllByRole('button', { name: /^Игроки/ })[0]);
  await user.click(screen.getByRole('button', { name: /^Заявки/ }));
  await user.click(screen.getByRole('button', { name: 'Принять' }));
  await user.click(screen.getByRole('button', { name: 'Друзья' }));
  assert.ok(screen.getByText('polina')); assert.ok(screen.getByText('nikita'));
  await user.click(screen.getByRole('button', { name: 'Мой профиль' }));
  await user.click(screen.getByRole('button', { name: 'Мой режим' }));
  const modal = within(screen.getByRole('dialog'));
  await user.clear(modal.getByLabelText('Твой ник'));
  await user.type(modal.getByLabelText('Твой ник'), 'new.overman');
  await user.click(modal.getByRole('button', { name: /Сохранить режим/ }));
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  assert.ok(screen.getByRole('heading', { name: 'new.overman' }));
});
