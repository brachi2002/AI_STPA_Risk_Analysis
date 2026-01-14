import * as fs from 'fs';
import * as path from 'path';

export type Fixture = {
  name: string;
  category: string;
  text: string;
};

export function loadSystemDescriptionFixtures(): Fixture[] {
  const root = path.join(__dirname, '..', 'fixtures', 'system_descriptions');
  const files = fs.readdirSync(root).filter((file) => file.endsWith('.txt'));
  return files.map((file) => {
    const full = path.join(root, file);
    const text = fs.readFileSync(full, 'utf-8');
    const name = path.basename(file, '.txt');
    const category = name.split('_')[0];
    return { name, category, text };
  });
}
