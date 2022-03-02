import { join } from 'path'

// eslint-disable-next-line no-unused-vars
const NuxtModule = function (moduleOptions = {}) {
  // Register components directories.
  this.nuxt.hook('components:dirs', dirs => {
    dirs.push({ path: join(__dirname, 'components') })
  })
}

export default NuxtModule
