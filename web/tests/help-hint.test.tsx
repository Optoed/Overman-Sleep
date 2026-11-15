import './dom';
import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';import {render,screen,cleanup} from '@testing-library/react';import userEvent from '@testing-library/user-event';
// Node verifies interaction semantics; real CSS is checked in the mobile browser.
registerHooks({load(url,context,next){if(url.endsWith('.module.css'))return {format:'module',shortCircuit:true,source:'export default new Proxy({}, {get:(_,name)=>String(name)})'};return next(url,context);}});
const {default:HelpHint}=await import('../components/sleep/help-hint');
afterEach(cleanup);
test('hint stays visually hidden until hover/focus; touch click pins; Escape closes it',async()=>{const user=userEvent.setup();render(<HelpHint label="О показателе" text="Короткое пояснение"/>);assert.equal(screen.queryByRole('tooltip'),null);const button=screen.getByRole('button',{name:'О показателе'});await user.hover(button);assert(screen.getByRole('tooltip'));await user.unhover(button);assert.equal(screen.queryByRole('tooltip'),null);await user.click(button);assert(screen.getByRole('tooltip'));await user.unhover(button);assert(screen.getByRole('tooltip'));await user.keyboard('{Escape}');assert.equal(screen.queryByRole('tooltip'),null);});
