<?php
/**
 * Mpgs Plugin abstract class.
 *
 * @package  MPGSCore
 * @version  1.0.0
 */

namespace MPGSCore;

/**
 * Abstract class for child MPGS plugins.
 */
abstract class MpgsPlugin {

	/**
	 * MPGS Core instance.
	 *
	 * @var Main
	 */
	private static $mpgs_core_instance;


	/**
	 * Plugin ID.
	 *
	 * @var string
	 */
	protected static $plugin_id;


	/**
	 * Text domain.
	 *
	 * @var string
	 */
	protected static $text_domain;


	/**
	 * Plugin file.
	 *
	 * @var string
	 */
	protected static $plugin_file;


	/**
	 * Core plugin file.
	 *
	 * @var string
	 */
	protected static $core_plugin_file;


	/**
	 * Plugin title.
	 *
	 * @var string
	 */
	protected static $plugin_title;


	/**
	 * Registered payment gateways.
	 *
	 * @var array
	 */
	protected static $registered_gateways;


	/**
	 * Get the plugin ID.
	 *
	 * @return string
	 */
	public static function plugin_id() {
		return self::$plugin_id;
	}


	/**
	 * Get the translation domain.
	 *
	 * @return string
	 */
	public static function text_domain() {
		return self::$text_domain;
	}


	/**
	 * Get the plugin file.
	 *
	 * @return string
	 */
	public static function plugin_file() {
		return self::$plugin_file;
	}


	/**
	 * Get the core plugin file.
	 *
	 * @return string
	 */
	public static function core_plugin_file() {
		return self::$core_plugin_file;
	}


	/**
	 * Get the plugin title.
	 *
	 * @return string
	 */
	public static function plugin_title() {
		return self::$plugin_title;
	}


	/**
	 * Init static properties.
	 *
	 * @return bool
	 */
	public static function init_static_properties() {
		return false;
	}


	/**
	 * Register the payment gateways.
	 *
	 * @return array
	 */
	public static function registered_gateways() {
		return self::$registered_gateways;
	}


	/**
	 * Add payment gateways.
	 *
	 * @param  array $methods Payment gateways.
	 *
	 * @return array
	 */
	public static function add_gateways( $methods ) {
		if ( empty( self::registered_gateways() ) || ! is_array( self::registered_gateways() ) ) {
			return $methods;
		}

		return array_merge( $methods, self::registered_gateways() );
	}


	/**
	 * Constructor
	 */
	public static function bootstrap() {
		if ( ! static::init_static_properties() ) {
			return;
		}

		if ( ! static::load_mpgs_core() || empty( static::plugin_id() ) ) {
			return;
		}

		self::init_core_instance();

		register_activation_hook( static::plugin_file(), array( Install::class, 'install' ) );

		// Activation hook.
		add_action( 'admin_init', array( __CLASS__, 'maybe_redirect_to_settings' ) );
		add_action( 'admin_init', array( __CLASS__, 'maybe_add_not_connected_notice' ) );

		// Load the plugin.
		add_action( 'plugins_loaded', array( __CLASS__, 'load' ) );
	}


	/**
	 * Load the MPGSCore package.
	 *
	 * @return bool
	 */
	private static function load_mpgs_core() {
		if ( ! file_exists( dirname( static::plugin_file() ) . '/packages/mpgs-core/mpgs-core.php' ) ) {
			add_action( 'admin_notices', array( __CLASS__, 'missing_mpgs_core_notice' ) );
			return false;
		}

		return include_once dirname( static::plugin_file() ) . '/packages/mpgs-core/mpgs-core.php';
	}


	/**
	 * Display an admin notice if the MPGSCore package is missing.
	 */
	public static function missing_mpgs_core_notice() {
		?>
		<div class="notice notice-error">
			<p>
				<?php esc_html_e( 'The plugin package is corrupt or incomplete: MPGS Core package is missing.', 'woocommerce-gateway-acme-mpgs' ); ?>
			</p>
		</div>
		<?php
	}


	/**
	 * Display an admin notice if the gateway is not connected.
	 */
	public static function maybe_add_not_connected_notice() {
		if ( self::is_enabled() && self::get_validated_credentials() ) {
			return;
		}
		?>
		<div class="notice notice-error">
			<p>
				<?php
				echo wp_kses_post(
					sprintf(
						__( 'The %1$s credentials are either empty or not valid. Verify your connection %2$shere%3$s', 'woocommerce-gateway-acme-mpgs' ),
						static::plugin_title(),
						'<a href="' . static::settings_url() . '">',
						'</a>',
					)
				);
				?>
			</p>
		</div>
		<?php
	}


	/**
	 * Cloning is forbidden.
	 *
	 * @since 1.0.0
	 */
	public function __clone() {
		_doing_it_wrong( __FUNCTION__, esc_html__( 'Cheatin&#8217; huh?', static::text_domain() ), '1.0.0' );
	}


	/**
	 * Unserializing instances of this class is forbidden.
	 *
	 * @since 1.0.0
	 */
	public function __wakeup() {
		_doing_it_wrong( __FUNCTION__, esc_html__( 'Cheatin&#8217; huh?', static::text_domain() ), '1.0.0' );
	}


	/**
	 * Maybe redirect to the settings page on first activation.
	 *
	 * @return void
	 */
	public static function maybe_redirect_to_settings() {
		$already_redirected = get_option( static::prefix_hook( 'installed', 'woocommerce_' ) );

		if ( $already_redirected ) {
			return;
		}

		update_option( static::prefix_hook( 'installed', 'woocommerce_' ), true );

		// Redirect to the settings page.
		exit( wp_safe_redirect( static::settings_url() ) );
	}


	/**
	 * Include plugins files and hook into actions and filters.
	 *
	 * @since  1.0.0
	 */
	public static function load() {

		// Load Localisation files.
		static::load_plugin_textdomain();

		add_filter( 'plugin_action_links_' . plugin_basename( static::plugin_file() ), array( __CLASS__, 'plugin_action_links' ) );
	}


	/**
	 * Initialize the MPGS Core instance.
	 */
	private static function init_core_instance() {
		static::$mpgs_core_instance = Main::instance( static::plugin_id() );

		// Filter the text domain for translations on the mpgs-core package.
		add_filter( static::prefix_hook( 'text_domain' ), array( __CLASS__, 'text_domain' ) );

		// Filter the plugin file on the core package.
		add_filter( static::prefix_hook( 'plugin_file' ), array( __CLASS__, 'plugin_file' ) );
		add_filter( static::prefix_hook( 'core_plugin_file' ), array( __CLASS__, 'core_plugin_file' ) );

		// Filter the plugin file on the core package.
		add_filter( static::prefix_hook( 'plugin_title' ), array( __CLASS__, 'plugin_title' ) );

		// Register the payment gateways.
		add_filter( 'mpgs_core_payment_gateways', array( __CLASS__, 'add_gateways' ) );
	}


	/**
	 * Get the MPGS Core instance.
	 *
	 * @return Main
	 */
	public static function mpgs_core() {
		return static::$mpgs_core_instance;
	}


	/**
	 * Load Localisation files.
	 */
	public static function load_plugin_textdomain() {

		// Add plugin's locale.
		$locale = apply_filters( 'plugin_locale', get_locale(), static::text_domain() );

		load_textdomain(
			static::text_domain(),
			sprintf(
				'%1$s/%2$s/%2$s-%3$s.mo',
				WP_LANG_DIR,
				static::text_domain(),
				$locale,
			)
		);

		load_plugin_textdomain( static::text_domain(), false, plugin_basename( __DIR__ ) . '/i18n/languages' );
	}


	/**
	 * Add plugin action links.
	 *
	 * @param  array $links Plugin action links.
	 */
	public static function plugin_action_links( $links ) {
		$plugin_links = array(
			sprintf(
				'<a href="%s">%s</a>',
				static::settings_url(),
				__( 'Settings', 'woocommerce-gateway-acme-mpgs' )
			),
		);

		return array_merge( $plugin_links, $links );
	}


	/**
	 * Get the settings page URL.
	 *
	 * @return string
	 */
	public static function settings_url() {
		return ! empty( static::plugin_id() ) ? add_query_arg(
			array(
				'page'    => 'wc-settings',
				'tab'     => 'checkout',
				'section' => static::plugin_id(),
			),
			admin_url( 'admin.php' )
		) : '';
	}


	/**
	 * Prefix a hook with the plugin ID.
	 *
	 * @param  string $hook   The name of the hook.
	 * @param  string $prefix Prefix for the hook.
	 *
	 * @return string
	 */
	public static function prefix_hook( $hook, $prefix = '' ) {
		return $prefix . static::plugin_id() . '_' . $hook;
	}


	/**
	 * Gateway settings.
	 *
	 * @return array
	 */
	public static function get_gateway_settings() {
		static $settings = array();

		if ( isset( $settings[ static::plugin_id() ] ) ) {
			return $settings[ static::plugin_id() ];
		}

		$settings[ static::$plugin_id ] = get_option( 'woocommerce_' . static::plugin_id() . '_settings', array() );

		return $settings[ static::plugin_id() ];
	}


	/**
	 * Get gateway specific setting.
	 *
	 * @param  string $key Setting key.
	 *
	 * @return mixed
	 */
	public static function get_gateway_setting( $key ) {
		$settings = static::get_gateway_settings();

		return isset( $settings[ $key ] ) ? $settings[ $key ] : '';
	}


	/**
	 * Get validated credentials.
	 *
	 * @return array
	 */
	public static function get_validated_credentials() {
		return get_option( 'woocommerce_' . static::plugin_id() . '_validated_credentials', false );
	}


	/**
	 * Update validated credentials.
	 *
	 * @param bool $validated_credentials Validated credentials.
	 */
	public static function update_validated_credentials( $validated_credentials ) {
		update_option( 'woocommerce_' . static::plugin_id() . '_validated_credentials', $validated_credentials );
	}


	/**
	 * Get validated payment operations.
	 *
	 * @return array
	 */
	public static function get_payment_operations() {
		return get_option( 'woocommerce_' . static::plugin_id() . '_payment_operations', array() );
	}


	/**
	 * Save validated payment operations.
	 *
	 * @param array $options Payment operations.
	 */
	public static function update_payment_operations( $options ) {
		update_option( 'woocommerce_' . static::plugin_id() . '_payment_operations', $options );
	}


	/**
	 * Is the gateway enabled.
	 *
	 * @return bool
	 */
	public static function is_enabled() {
		return ! empty( static::get_gateway_setting( 'enabled' ) ) && 'yes' === static::get_gateway_setting( 'enabled' ) ? true : false;
	}


	/**
	 * Is sandbox mode enabled.
	 *
	 * @return bool
	 */
	public static function is_sandbox() {
		return ( self::is_enabled() && ! self::get_validated_credentials() ) || ( ! empty( static::get_gateway_setting( 'sandbox' ) ) && 'yes' === static::get_gateway_setting( 'sandbox' ) ) ? true : false;
	}
}
