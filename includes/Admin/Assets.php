<?php
/**
 * Register admin assets.
 *
 * @class       AdminAssets
 * @version     1.0.0
 * @package     MPGSCore/Classes/
 */

namespace MPGSCore\Admin;

use MPGSCore\Assets as AssetsMain;
use MPGSCore\Utils;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Admin assets class
 */
final class Assets {

	/**
	 * Hook in methods.
	 */
	public static function hooks() {
		add_filter( 'mpgs_core_enqueue_styles', array( __CLASS__, 'add_styles' ), 9 );
		add_filter( 'mpgs_core_enqueue_scripts', array( __CLASS__, 'add_scripts' ), 9 );
		add_action( 'admin_enqueue_scripts', array( AssetsMain::class, 'load_scripts' ) );
		add_action( 'admin_print_scripts', array( AssetsMain::class, 'localize_printed_scripts' ), 5 );
		add_action( 'admin_print_footer_scripts', array( AssetsMain::class, 'localize_printed_scripts' ), 5 );
	}


	/**
	 * Add styles for the admin.
	 *
	 * @param array $styles Admin styles.
	 * @return array<string,array>
	 */
	public static function add_styles( $styles ) {

		$styles['mpgs-core-admin'] = array(
			'src' => AssetsMain::localize_asset( 'css/admin/mpgs-core.css' ),
		);

		return $styles;
	}


	/**
	 * Add scripts for the admin.
	 *
	 * @param  array $scripts Admin scripts.
	 * @return array<string,array>
	 */
	public static function add_scripts( $scripts ) {

		$scripts['mpgs-core-admin'] = array(
			'src'  => AssetsMain::localize_asset( 'js/admin/mpgs-core.js' ),
			'data' => array(
				'ajax_url' => Utils::ajax_url(),
			),
		);

		return $scripts;
	}
}
