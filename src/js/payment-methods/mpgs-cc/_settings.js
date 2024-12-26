/**
 * Internal dependencies
 */
import { PAYMENT_METHOD_NAME } from './_constants';
import { getBlocksConfiguration } from '../_utils';

export const settings = getBlocksConfiguration( PAYMENT_METHOD_NAME + '_data' );

export const getPrefix = () => {
	return settings?.pluginPrefix || 'mpgs';
};

export const getSessionId = () => {
	return settings?.sessionId || '';
};

export const getTextDomain = () => {
	return settings?.textDomain || 'woocommerce';
};

export const addPrefix = ( str ) => {
	return `${ getPrefix() }_${ str }`;
};
