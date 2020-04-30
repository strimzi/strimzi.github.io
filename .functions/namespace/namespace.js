/* eslint-disable */

const fetch = require('node-fetch');
const yaml = require('js-yaml');

exports.handler = async function(event, context) {
  try {
    // Get and validate the namespace parameter
    const namespace = event.queryStringParameters["namespace"];
    
    if (namespace === undefined || namespace === null || namespace === '')  {
      console.log('Namespace is empty or not specified');
      throw "Namespace is empty or not specified";
    } else {
      console.log('Preparing install files for namespace ' + namespace);
    }
    
    // Fetch the latest installation YAMLs
    const response = await fetch('https://strimzi.io/install/latest');
    
    if (!response.ok) {
      // NOT res.status >= 200 && res.status < 300
      return { statusCode: response.status, body: response.statusText }
    }
    
    const data = await response.text()

    // Change the namespaces
    const fixedRbacNamespaces = data.replace(new RegExp('namespace: myproject', 'g'), 'namespace: ' + namespace)
    let fixedAllNamespaces = String()
    yaml.safeLoadAll(fixedRbacNamespaces, function (doc) {
      if (doc !== null) {
        // Set namespace only for namespaced resources
        if (doc.kind != "ClusterRole" 
              && doc.kind != "ClusterRoleBinding"
              && doc.kind != "CustomResourceDefinition")  {
          doc.metadata['namespace'] = namespace;
        }

        fixedAllNamespaces += "\n---\n" + yaml.safeDump(doc);
      }
    });
    
    // Replace the namspace: myproject for namespace: whatever
    return {
      statusCode: 200,
      body: fixedAllNamespaces
    }
  } catch (err) {
    // Handle errors
    console.log('Some error occured: ' + err);
    return {
      statusCode: 500,
      body: err
    }
  }
}
