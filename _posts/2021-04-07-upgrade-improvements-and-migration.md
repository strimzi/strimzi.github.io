---
layout: post
title:  "Building your own Kafka Connect image with a custom resource"
date: 2021-04-07
author: jakub_stejskal
---
Upgrade process of Strimzi and Kafka is not trivial. 
In Strimzi 0.22 we introduced several improvements, which will make the process easier for the users. 
Moreover, we also introduced new API version `v1beta2` which will replace `v1beta1` because [Kubernetes 1.22 will remove support](https://kubernetes.io/docs/reference/using-api/deprecation-guide/#customresourcedefinition-v122) for `apiextensions/v1beta1`.
This blog post will show you how the upgrade process changed and what you should do to keep your cluster working without issues.

<!--more-->

### Upgrade improvements

Legacy upgrade process was a little complicated.
Users had to have fill Kafka `version`, but also `log.message.format.version` or `inter.broker.protocol.version` before the upgrade.
This makes the upgrades hard to execute fully automatically for example when you use Strimzi installed from [OperatorHub](https://operatorhub.io/operator/strimzi-kafka-operator).
You also needed to upgrade through all versions of Strimzi and Kafka.
For example if you wanted to upgrade from 0.18 to 0.20, you had to install 0.19 firstly and then do the same steps for 0.20.

Now, the process is not too strict.
Strimzi now does the following things regarding Kafka configuration:
* detect used Kafka `version`, `log.message.format.version` and `inter.broker.protocol.version` (from CR or compute it from Kafka `version`)
* configure Kafka `version`, `log.message.format.version` and `inter.broker.protocol.version` if it's not specified by user

The main improvement is, that you don't need to upgrade across all Strimzi versions, but you can upgrade from for instance 0.18 directly to 0.22. 
You can face the following states:
* Supported Kafka `version` and `log.message.format.version` or `inter.broker.protocol.version` is set in CR - Strimzi will keep the values and missing one will se based on `version`.
* Supported Kafka `version` is set, `log.message.format.version` and `inter.broker.protocol.version` are not set in CR - Strimzi will set `log.message.format.version` and `inter.broker.protocol.version` based on `version`
* Supported Kafka `version` is not set in CR - Strimzi will set Kafka `version`, `log.message.format.version` and `inter.broker.protocol.version` based on the default Kafka supported in 0.22.
* Unsupported Kafka `version` is set in CR - Strimzi will set `Kafka` CR status to `NotReady`. 
  In that case user has to update CR and manually set a proper config.
  
Even with these changes, there are still some disadvantages:
* For upgrade, roll out the new brokers while first using the older `log.message.format.version` or `inter.broker.protocol.version` and only afterwards change to the new versions for message format and inter-broker protocol.
* Downgrade won't be executed when new `log.message.format.version` or `inter.broker.protocol.version` are already used.
You need to change configuration to use same `log.message.format.version` and `inter.broker.protocol.version` as older Kafka.
  
You can find further information in our [documentation](https://strimzi.io/docs/operators/latest/deploying.html#assembly-upgrade-str).

### New API versions

As we stated before, we introduced new API version `v1beta2` for Strimzi resources. 
Every user of Strimzi will have to the migration from old `v1beta1` to `v1beta2`.
This migration is not necessarily needed right after upgrade to Strimzi 0.22, but has to be done before upgrade to Strimzi 0.23.
The main reason why Strimzi users had to do this migration are preparations of Strimzi to use Kubernetes CRD `apiextensions/v1`.

Custom resources are edited and controlled using APIs added to Kubernetes by CRDs. 
Put another way, CRDs extend the Kubernetes API to allow the creation of custom resources. 
CRDs are themselves resources within Kubernetes. 
They are installed in a Kubernetes cluster to define the versions of API for the custom resource. 
Each version of the custom resource API can define its own schema for that version. 
Kubernetes clients, including the Strimzi Operators, access the custom resources served by the Kubernetes API server using a URL path (API path), which includes the API version

In 0.21, we supported custom resource version `v1alpha` for all custom resources and `v1beta1` for `Kafka`, `KafkaConnect`, `KafkaConnectS2I`, `KafkaMirrorMaker`, `KafkaUser` and `KafkaTopic`.
These versions are currently deprecated and will be dropped in the following Strimzi minor release.

One another change is, that with new API version we remove some deprecated fields so users need to migrate them to new format.
For instance `v1beta2` supports only new array based listener configuration and new metrics configuration formats from config maps.
In additional some old unused fields like `tlsSidecar` were removed as well. 

For smooth migration to new CRs and CRDs version we created `api-conversion` tool.

### API conversion tool

The tool is shipped as part of Strimzi 0.22 in [zip](https://github.com/strimzi/strimzi-kafka-operator/releases/download/0.22.1/api-conversion-0.22.1.zip) and [tar.gz](https://github.com/strimzi/strimzi-kafka-operator/releases/download/0.22.1/api-conversion-0.22.1.tar.gz) archives. 
After un-archive, you will find there all libs needed by the tool in `libs` directory and two scripts for running the tool in folder `bin`.
Script `api-conversion.sh` is for linux/mac users and `api-conversion.cmd` is for Windows users.
You can find there also a readme, which is also available on [Strimzi github](https://github.com/strimzi/strimzi-kafka-operator/tree/release-0.22.x/api-conversion).

The tool can operate in two modes:
* convert your resources to `v1beta2`. It can convert resources in yaml files or resource already deployed into Kubernetes cluster.
* convert CRDs to use `v1beta2` as a stored version and use `apiextensions/v1`.

You can use the tool directly from un-archived directory as it's shown in the example bellow.

```bash
bin/api-conversion.sh --help
Usage: bin/api-conversion.sh [-hV] [COMMAND]
Conversion tool for Strimzi Custom Resources
  -h, --help      Show this help message and exit.
  -V, --version   Print version information and exit.
Commands:
  help                                     Displays help information about the
                                             specified command
  convert-file, cf                         Convert Custom Resources from YAML
                                             file
  convert-resource, cr, convert-resources  Convert Custom Resources directly in
                                             Kubernetes
  crd-upgrade, crd                         Upgrades the Strimzi CRDs and CRs to
                                             use v1beta2 version
```



`convert-file` command basically takes input yaml file passed via option `-f` or `--file` and convert it.
The output will be printed to _stdout_ or you can specify output file with `-o` or `--output` options.


has the following options for use:
* `-f`, `--file` - 
* `-o`, `--output` - 
* `--in-place` - 

All command olso hav ``

### Conclusion

TODO
