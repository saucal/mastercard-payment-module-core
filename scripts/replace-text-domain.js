const fs = require( 'fs' );
const path = require( 'path' );

const args = process.argv.slice( 2 );
const baseDir = args.find( ( a ) => a.startsWith( '--base-dir=' ) );
const positional = args.filter( ( a ) => ! a.startsWith( '--' ) );
const [ search, replace ] = positional;

if ( ! search || ! replace ) {
	console.error( 'Usage: node replace-text-domain.js <search> <replace> [--base-dir=<path>]' );
	process.exit( 1 );
}

const rootDir = baseDir
	? path.resolve( baseDir.split( '=' )[ 1 ] )
	: path.resolve( __dirname, '..' );

const IGNORE = [ 'vendor', 'node_modules' ];
const files = fs.readdirSync( rootDir, { recursive: true } )
	.filter( ( f ) => f.endsWith( '.php' ) && ! IGNORE.some( ( dir ) => f.startsWith( dir + path.sep ) ) );

let totalReplacements = 0;
let filesChanged = 0;

for ( const file of files ) {
	const filePath = path.join( rootDir, file );
	const content = fs.readFileSync( filePath, 'utf8' );

	if ( ! content.includes( search ) ) {
		continue;
	}

	const count = content.split( search ).length - 1;
	const updated = content.split( search ).join( replace );

	fs.writeFileSync( filePath, updated, 'utf8' );
	filesChanged++;
	totalReplacements += count;
	console.log( `  ${ file }: ${ count } replacement(s)` );
}

console.log( `\nDone: ${ totalReplacements } replacement(s) in ${ filesChanged } file(s).` );
