// Kommandozeile: "node src/cli.js suchlauf" (z. B. für die Windows-Aufgabenplanung) und "node src/cli.js testmail".
import { runCrawl, rescoreAll } from './crawl.js';
import { sendTestMail } from './notify.js';
import { closeDb } from './db.js';

const command = process.argv[2] || 'suchlauf';

try {
  if (command === 'suchlauf') {
    const { status } = await runCrawl();
    process.exitCode = status === 'fehlgeschlagen' ? 1 : 0;
  } else if (command === 'testmail') {
    await sendTestMail();
    console.log('Testmail versendet.');
  } else if (command === 'neu-bewerten') {
    console.log(await rescoreAll());
  } else {
    console.log('Befehle: suchlauf | testmail | neu-bewerten');
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`Fehler: ${error.message}`);
  process.exitCode = 1;
} finally {
  closeDb();
}
