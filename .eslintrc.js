module.exports = {
	env: {
		browser: true,
		es6: true,
		node: true,
	},
	globals: {
		wp: true,
		es6: true,
	},
	rules: {
		camelcase: 0,
		indent: 0,
		'no-console': 1,
		'prettier/prettier': [
			'error',
			{
				endOfLine: 'auto',
			},
		],
	},
	parser: '@babel/eslint-parser',
	parserOptions: {
		ecmaVersion: 8,
		ecmaFeatures: {
			modules: true,
			experimentalObjectRestSpread: true,
			jsx: true,
		},
	},
};
