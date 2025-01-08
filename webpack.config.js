/**
 * SAU/CAL webpack configuration
 *
 * Version 0.0.1
 *
 */

// Add dependencies
const MiniCssExtractPlugin = require( 'mini-css-extract-plugin' );
const RemoveEmptyScriptsPlugin = require('webpack-remove-empty-scripts');
const CssMinimizerPlugin = require( 'css-minimizer-webpack-plugin' );
const glob = require( 'glob' );
const package = require( './package.json' );
if ( ! package.assets ) {
	console.log( 'Please define assets directories in package.json' );
	return;
}

// Define paths
const path = require( 'path' );
const cssPaths = package.assets.css ? package.assets.css : {};
const jsPaths = package.assets.js ? package.assets.js : {};

cssPaths.src = path.join( process.cwd(), cssPaths.src );
jsPaths.src = path.join( process.cwd(), jsPaths.src );
cssPaths.out = path.join( process.cwd(), cssPaths.out );
jsPaths.out = path.join( process.cwd(), jsPaths.out );

// Define config variable
const config = [];

// Add SCSS file/s to config variable
const cssEntries = {};

// Add JS file/s to config variable
const jsEntries = {};

// ------------------------------------------------------------------------------------------------------------
// Maybe add CSS assets to config variable

if ( cssPaths.out ) {
	const sassFiles = glob.sync(
		path.join( cssPaths.src, '**', '[^_]*.scss' )
	);

	sassFiles.forEach( ( file ) => {
		const relative = path.relative( cssPaths.src, file );
		const relativeOut = path.relative( process.cwd(), cssPaths.out );
		const name = path.join(
			relativeOut,
			relative.substring( 0, relative.length - 5 )
		);
		cssEntries[ name ] = file;
	} );
}

// ------------------------------------------------------------------------------------------------------------
// Maybe add JS assets to config variable

if ( jsPaths.out ) {
	const jsFiles = glob.sync( path.join( jsPaths.src, '**', '[^_]*.js' ) );
	jsFiles.forEach( ( file ) => {
		const relative = path.relative( jsPaths.src, file );
		const relativeOut = path.relative( process.cwd(), jsPaths.out );
		const name = path.join(
			relativeOut,
			relative.substring( 0, relative.length - 3 )
		);
		jsEntries[ name ] = file;
	} );
}

const baseConfig = {
	entry: {
		...cssEntries,
		...jsEntries,
	},
	output: {
		path: process.cwd(),
		filename: '[name].js',
	},
	module: {
		rules: [
			{
				test: /\.(sc|sa|c)ss$/,
				use: [
					MiniCssExtractPlugin.loader,
					'css-loader',
					'sass-loader',
				],
			},
			{
				loader: 'babel-loader',
				test: /\.js$/,
				exclude: /node_modules/,
			},
			{
				test: /\.(bmp|png|jpe?g|gif|svg|webp)$/i,
				type: 'asset/resource',
				exclude: /node_modules/,
				generator: {
					filename: 'assets/images/[name][ext]',
				},
			},
		],
	},
	plugins: [
		new RemoveEmptyScriptsPlugin(),
		new MiniCssExtractPlugin( {
			filename: '[name].css',
		} ),
	],
	optimization: {
		minimize: false,
	},
};

const minifiedConfig = {
	...baseConfig,
	mode: 'production',
	plugins: [
		new RemoveEmptyScriptsPlugin(),
		new MiniCssExtractPlugin( {
			filename: '[name].min.css',
		} ),
	],
	output: {
		...baseConfig.output,
		filename: '[name].min.js',
	},
	optimization: {
		minimize: true,
		minimizer: [ `...`, new CssMinimizerPlugin() ],
		removeEmptyChunks: true,
	},
};

config.push( baseConfig );
config.push( minifiedConfig );

module.exports = config;
