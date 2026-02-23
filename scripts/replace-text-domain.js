const fs = require( 'fs' );
const path = require( 'path' );
const { globSync } = require( 'glob' );

const [ search, replace ] = process.argv.slice( 2 );

if ( ! search || ! replace ) {
	console.error( 'Usage: node replace-text-domain.js <search> <replace>' );
	process.exit( 1 );
}

const searchQuoted = `'${ search }'`;
const replaceQuoted = `'${ replace }'`;

const rootDir = path.resolve( __dirname, '..' );
const files = globSync( '{includes,templates}/**/*.php', { cwd: rootDir } );

let totalReplacements = 0;
let filesChanged = 0;

for ( const file of files ) {
	const filePath = path.join( rootDir, file );
	const content = fs.readFileSync( filePath, 'utf8' );

	if ( ! content.includes( searchQuoted ) ) {
		continue;
	}

	const updated = content.split( searchQuoted ).join( replaceQuoted );
	const count = ( content.split( searchQuoted ).length - 1 );

	fs.writeFileSync( filePath, updated, 'utf8' );
	filesChanged++;
	totalReplacements += count;
	console.log( `  ${ file }: ${ count } replacement(s)` );
}

console.log( `\nDone: ${ totalReplacements } replacement(s) in ${ filesChanged } file(s).` );
