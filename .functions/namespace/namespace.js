/* eslint-disable */

const fetch = require('node-fetch')

exports.handler = async function(event, context) {
  try {
    const namespace = event.queryStringParameters["namespace"]
    console.log("Preparing install files for namespace " + namespace)
    
    const response = await fetch('https://strimzi.io/install/latest')
    if (!response.ok) {
      // NOT res.status >= 200 && res.status < 300
      return { statusCode: response.status, body: response.statusText }
    }
    const data = await response.text()

    return {
      statusCode: 200,
      body: data.replace("namespace: myproject", "namespace: " + namespace)
    }
  } catch (err) {
    console.log(err) // output to netlify function log
    return {
      statusCode: 500,
      body: JSON.stringify({ msg: err.message }) // Could be a custom message or object i.e. JSON.stringify(err)
    }
  }
}
