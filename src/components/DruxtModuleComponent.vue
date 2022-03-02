<script>
import DruxtModule from 'druxt/dist/components/DruxtModule.vue'

export default {
  // @TODO - Rename your module's component name.
  name: 'DruxtModuleComponent',

  extends: DruxtModule,

  data: () => ({
    foo: undefined,
    settings: undefined,
  }),

  /**
   * Druxt hooks.
   */
  druxt: {
    /**
     * Load configuration data.
     */
    async fetchConfig() {
      this.foo = 'bar'
    },

    /**
     * Load data using the provided settings.
     *
     * @param {object} settings - The settings object for this Druxt module.
     */
    async fetchData(settings) {
      this.settings = settings
    },

    /**
     * Create component options for Druxt Wrapper component.
     *
     * @param {object} context - The Druxt module context object.
     */
    componentOptions: (context) => ([
      [context.foo, 'default'],
      ['default']
    ]),

    /**
     * Create an object of props data to be used by the Druxt Wrapper component.
     *
     * @param {object} context - The Druxt module context object.
     */
    propsData: (context) => ({
      foo: context.foo
    }),

    /**
     * Create an object of scoped slots to be used by the Druxt Wrapper component.
     *
     * @param {function} h - The Vue hyperscript function.
     */
    slots(h) {
      return {
        default: () => h('div', ['Hello world'])
      }
    }
  }
}
</script>
