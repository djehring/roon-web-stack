const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

const SIZES = [512, 256, 192, 144, 96, 32, 16];
const PRECOMPOSED_SIZES = [180, 152, 120];
const OUTPUT_DIR = path.join('app', 'roon-web-ng-client', 'src', 'assets', 'favicons');

async function generateTestIcons() {
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    // Create a red circle SVG buffer
    const circleSvg = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
        <circle cx="256" cy="256" r="200" fill="red" />
      </svg>
    `);

    // Generate PNGs
    const image = sharp(circleSvg);
    const tasks = SIZES.map(async (size) => {
      const outputPath = path.join(OUTPUT_DIR, `favicon-${size}.png`);
      await image
        .clone()
        .resize(size, size)
        .png()
        .toFile(outputPath);
      console.log(`Generated ${size}x${size}: ${outputPath}`);
    });

    const precomposedTasks = PRECOMPOSED_SIZES.map(async (size) => {
      const outputPath = path.join(OUTPUT_DIR, `favicon-${size}-precomposed.png`);
      await image
        .clone()
        .resize(size, size)
        .flatten({ background: { r: 0, g: 0, b: 0 } }) // Opaque black background
        .png()
        .toFile(outputPath);
      console.log(`Generated ${size}x${size} precomposed: ${outputPath}`);
    });

    await Promise.all([...tasks, ...precomposedTasks]);

    // Copy 32x32 for ICO
    await fs.copyFile(
      path.join(OUTPUT_DIR, 'favicon-32.png'),
      path.join(OUTPUT_DIR, 'favicon.ico')
    );
    console.log('Generated favicon.ico');

    console.log('Test icons generated successfully!');
  } catch (error) {
    console.error('Error generating test icons:', error);
    process.exit(1);
  }
}

generateTestIcons();