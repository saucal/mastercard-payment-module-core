<?php
/**
 * Contains template related methods.
 *
 * @class       Template
 * @version     1.0.0
 * @package     GatewayPaymentCore/Classes/
 */

namespace GatewayPaymentCore;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Template Class.
 */
final class Template {


	/**
	 * Main instance.
	 *
	 * @var Main
	 */
	private $payment_core;


	/**
	 * Constructor.
	 *
	 * @param Main $payment_core Main instance.
	 */
	public function __construct( Main $payment_core ) {
		$this->payment_core = $payment_core;
	}


	/**
	 * Get template part.
	 *
	 * @param mixed  $slug Slug of the template to get.
	 * @param string $name (default: '') Template name (sub-slug if you will).
	 *
	 * @return void
	 */
	public function get_part( $slug, $name = '' ) {

		$template = '';

		// Look in yourtheme/slug-name.php and yourtheme/payment-core/slug-name.php .
		if ( $name ) {
			$template = locate_template( array( "{$slug}-{$name}.php", $this->payment_core->utils()->template_path() . "{$slug}-{$name}.php" ) );
		}

		// Get default slug-name.php .
		if ( ! $template && $name && file_exists( $this->payment_core->utils()->plugin_path() . "/templates/{$slug}-{$name}.php" ) ) {
			$template = $this->payment_core->utils()->plugin_path() . "/templates/{$slug}-{$name}.php";
		}

		// If template file doesn't exist, look in yourtheme/slug.php and yourtheme/payment-core/slug.php .
		if ( ! $template ) {
			$template = locate_template( array( "{$slug}.php", $this->payment_core->utils()->template_path() . "{$slug}.php" ) );
		}

		/**
		 * Filters the template part file path for third-party plugin overrides.
		 *
		 * @since 1.0.0
		 */
		$template = apply_filters( 'payment_core_get_template_part', $template, $slug, $name );

		if ( $template ) {
			load_template( $template, false );
		}
	}


	/**
	 * Get other templates passing attributes and including the file.
	 *
	 * @param string              $template_name Filename to locate.
	 * @param array<string,mixed> $args (default: array()) Args to send to template.
	 * @param string              $template_path (default: '') Path to look the template into.
	 * @param string              $default_path (default: '') Default path to fallback to.
	 *
	 * @return void
	 */
	public function get( $template_name, $args = array(), $template_path = '', $default_path = '' ) {

		if ( ! empty( $args ) && is_array( $args ) ) {
			// phpcs:ignore WordPress.PHP.DontExtract
			extract( $args );
		}

		$located = $this->locate( $template_name, $template_path, $default_path );

		if ( ! file_exists( $located ) ) {
			_doing_it_wrong( __FUNCTION__, sprintf( '<code>%s</code> does not exist.', $located ), '1.0.0' ); //phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			return;
		}

		/**
		 * Filters the template file path for third-party plugin overrides.
		 *
		 * @since 1.0.0
		 */
		$located = apply_filters( 'payment_core_get_template', $located, $template_name, $args, $template_path, $default_path );

		/**
		 * Fires before a template part is included.
		 *
		 * @since 1.0.0
		 */
		do_action( 'payment_core_before_template_part', $template_name, $template_path, $located, $args );

		if ( ! file_exists( $located ) ) {
			_doing_it_wrong( __FUNCTION__, sprintf( '<code>%s</code> does not exist.', $located ), '1.0.0' ); //phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			return;
		}

		include $located;

		/**
		 * Fires after a template part is included.
		 *
		 * @since 1.0.0
		 */
		do_action( 'payment_core_after_template_part', $template_name, $template_path, $located, $args );
	}


	/**
	 * Like get, but returns the HTML instead of outputting.
	 *
	 * @since 2.5.0
	 * @param string              $template_name Filename to locate.
	 * @param array<string,mixed> $args (default: array()) Args to send to template.
	 * @param string              $template_path (default: '') Path to look the template into.
	 * @param string              $default_path (default: '') Default path to fallback to.
	 * @return string
	 */
	public function get_html( $template_name, $args = array(), $template_path = '', $default_path = '' ) {

		ob_start();

		$this->get( $template_name, $args, $template_path, $default_path );

		$ret = ob_get_clean();

		return is_bool( $ret ) ? '' : $ret;
	}


	/**
	 * Locate a template and return the path for inclusion.
	 *
	 * This is the load order:
	 *
	 *      yourtheme       /   $template_path  /   $template_name
	 *      yourtheme       /   $template_name
	 *      $default_path   /   $template_name
	 *
	 * @param string $template_name Filename to locate.
	 * @param string $template_path (default: '') Path to look the template into.
	 * @param string $default_path (default: '') Default path to fallback to.
	 * @return string
	 */
	public function locate( $template_name, $template_path = '', $default_path = '' ) {

		if ( ! $template_path ) {
			$template_path = $this->payment_core->utils()->core_package_path();
		}

		if ( ! $default_path ) {
			$default_path = $this->payment_core->utils()->core_package_path() . '/templates/';
		}

		// Look within passed path within the theme - this is priority.
		$template = locate_template(
			array(
				trailingslashit( $template_path ) . $template_name,
				$template_name,
			)
		);

		// Get default template.
		if ( ! $template ) {
			$template = $default_path . $template_name;
		}

		/**
		 * Filters the located template file path.
		 *
		 * @since 1.0.0
		 */
		return apply_filters( 'payment_core_locate_template', $template, $template_name, $template_path );
	}
}
