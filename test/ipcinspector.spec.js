import { By, until } from 'selenium-webdriver';
import { driver } from './test.js';
import { expect } from 'chai';

const $ = selector => driver.findElement(By.css(selector));
const $$ = selector => driver.findElements(By.css(selector));

async function openInspector() {
  await driver.get('http://tauri.localhost/ipc-inspector');
  await driver.wait(until.elementLocated(By.css('[data-testid="ipc-inspector"]')), 10_000);
}

describe('IPC Inspector', () => {
  before(openInspector);

  it('lists every registered custom command', async () => {
    const cards = await $$('[data-testid^="command-"]');
    expect(cards.length).to.equal(4);
    const names = (await Promise.all(cards.map(card => card.findElement(By.css('[data-testid="command-name"]')).getText()))).sort();
    expect(names).to.deep.equal(['legacy_process_file', 'list_capabilities', 'process_file', 'tray_update_lang']);
  });

  it('process_file returns the structured success payload', async () => {
    const card = $('[data-testid="command-process_file"]');
    await card.findElement(By.css('[data-testid="run-process_file"]')).click();
    await driver.wait(until.elementLocated(By.css('[data-testid="command-process_file"] .mantine-JsonInput-input')), 10_000);
    const payload = await card.findElement(By.css('.mantine-JsonInput-input')).getAttribute('value');
    expect(payload).to.contain('Hello from Rust!');
  });

  it('structured error branch exposes EMPTY_FILEPATH code', async () => {
    const card = $('[data-testid="command-process_file"]');
    const input = card.findElement(By.css('[data-testid="arg-filepath"] input'));
    await input.clear();
    await card.findElement(By.css('[data-testid="run-process_file"]')).click();
    await driver.wait(until.elementLocated(By.css('[data-testid="command-process_file"] [data-testid="error-code"]')), 10_000);
    expect(await card.findElement(By.css('[data-testid="error-code"]')).getText()).to.equal('EMPTY_FILEPATH');
  });

  it('legacy command rejects with a plain string and no code', async () => {
    const card = $('[data-testid="command-legacy_process_file"]');
    const input = card.findElement(By.css('[data-testid="arg-filepath"] input'));
    await input.clear();
    await card.findElement(By.css('[data-testid="run-legacy_process_file"]')).click();
    await driver.wait(until.elementLocated(By.css('[data-testid="command-legacy_process_file"] [data-testid="error-message"]')), 10_000);
    const message = await card.findElement(By.css('[data-testid="error-message"]')).getText();
    expect(message).to.match(/must not be empty/);
    expect(await card.findElements(By.css('[data-testid="error-code"]'))).to.have.length(0);
  });

  it('FORBIDDEN_PATH renders the policy hint', async () => {
    const card = $('[data-testid="command-process_file"]');
    const input = card.findElement(By.css('[data-testid="arg-filepath"] input'));
    await input.clear();
    await input.sendKeys('secret/forbidden/path.txt');
    await card.findElement(By.css('[data-testid="run-process_file"]')).click();
    await driver.wait(async () => {
      const codes = await card.findElements(By.css('[data-testid="error-code"]'));
      return codes.length > 0 && (await codes[0].getText()) === 'FORBIDDEN_PATH';
    }, 10_000, 'expected FORBIDDEN_PATH error code');
  });

  it('reads the capability files actually compiled into the build', async () => {
    await $('[data-testid="tab-capabilities"]').click();
    await $('[data-testid="refresh-capabilities"]').click();
    await driver.wait(until.elementLocated(By.css('[data-testid="capability-main-core"]')), 10_000);
    for (const id of ['main-core', 'main-fs', 'main-plugins']) {
      expect(await $$(`[data-testid="capability-${id}"]`)).to.have.length(1);
    }
  });

  it('granted plugin command succeeds and ungranted dialog shows a readable ACL error', async () => {
    await $('[data-testid="probe-granted"]').click();
    await driver.wait(until.elementLocated(By.css('[data-testid="permission-probe"] .mantine-Badge-teal')), 10_000);

    await $('[data-testid="probe-denied"]').click();
    const messageEl = await driver.wait(until.elementLocated(By.css('[data-testid="permission-probe"] [data-testid="error-message"]')), 10_000);
    const message = await messageEl.getText();
    expect(message).to.match(/not allowed|permission|denied|ACL/i);
    expect(await $('[data-testid="permission-probe"] [data-testid="error-code"]').getText()).to.equal('ACL_DENIED');
  });
});
