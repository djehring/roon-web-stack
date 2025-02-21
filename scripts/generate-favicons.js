const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { optimize } = require('svgo');

const SIZES = [512, 256, 192, 144, 96, 32, 16];
const PRECOMPOSED_SIZES = [512, 256, 180, 152, 120];

const INPUT_FILE = process.argv[2];
if (!INPUT_FILE) {
  console.error('Please provide an input file path');
  process.exit(1);
}

async function generateFavicons() {
  try {
    const outputDir = path.join('app', 'roon-web-ng-client', 'src', 'assets', 'favicons');
    await fs.mkdir(outputDir, { recursive: true });

    // Generate SVG by embedding the full-color PNG
    const svgPath = path.join(outputDir, 'favicon.svg');
    const pngBuffer = await sharp(INPUT_FILE)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background
      })
      .png()
      .toBuffer();

    const svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 512 512" preserveAspectRatio="xMidYMid meet">
        <image width="512" height="512" href="data:image/png;base64,${pngBuffer.toString('base64')}" />
      </svg>
    `;

    // Optimize the SVG (minimal changes since it’s raster-based)
    const optimizedSvg = optimize(svgContent, {
      multipass: true,
      plugins: [
        {
          name: 'preset-default',
          params: {
            overrides: {
              removeViewBox: false
            }
          }
        }
      ]
    });

    await fs.writeFile(svgPath, optimizedSvg.data, 'utf8');
    console.log(`Generated full-color SVG favicon: ${svgPath}`);

    // Generate PNG variants
    const image = sharp(INPUT_FILE);
    const tasks = SIZES.map(async (size) => {
      const outputPath = path.join(outputDir, `favicon-${size}.png`);
      await image
        .clone()
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toFile(outputPath);
      console.log(`Generated ${size}x${size} favicon: ${outputPath}`);
    });

    const precomposedTasks = PRECOMPOSED_SIZES.map(async (size) => {
      const outputPath = path.join(outputDir, `favicon-${size}-precomposed.png`);
      const img = await image
        .clone()
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 1 }
        })
        .flatten({ background: { r: 0, g: 0, b: 0 } })
        .png();
      const metadata = await img.metadata();
      console.log(`Generated ${size}x${size} precomposed favicon: ${outputPath}, hasAlpha: ${metadata.hasAlpha}`);
      await img.toFile(outputPath);
    });
    await Promise.all([...tasks, ...precomposedTasks]);

    // Generate ICO from 32x32 PNG
    const icoPath = path.join(outputDir, 'favicon.ico');
    await fs.copyFile(path.join(outputDir, 'favicon-32.png'), icoPath);
    console.log(`Generated ICO file (using 32x32 PNG): ${icoPath}`);

    console.log('All favicons generated successfully!');
  } catch (error) {
    console.error('Error generating favicons:', error);
    process.exit(1);
  }
}

generateFavicons();