---
layout: post
title:  "Path to CRD v1"
date: 2021-04-18
author: jakub_stejskal
---
In Strimzi 0.22 we introduced the `v1beta2` API version to prepare Strimzi for Kubernetes 1.22. The `v1beta2` API version replaces the `v1beta1` and `v1alpha1` API versions.
This post shows you how to perform an API conversion to `v1beta2` to be ready for the next Strimzi releases.

<!--more-->
  
### New API versions

By introducing API version `v1beta2` for Strimzi resources, current Strimzi users must migrate from the old `v1alpha1`  and `v1beta1` versions.
This migration is not necessarily needed right after upgrade to Strimzi 0.22, but has to be done before upgrade to Strimzi 0.23 or later.
The main reason for the migration is to prepare Strimzi to use [Kubernetes CRD `apiextensions/v1`](https://kubernetes.io/docs/reference/using-api/deprecation-guide/#customresourcedefinition-v122).

Custom resources are created and controlled using APIs added to Kubernetes by CRDs.
Put another way, CRDs extend the Kubernetes API to allow the creation of custom resources.
CRDs are themselves resources within Kubernetes.
They are installed in a Kubernetes cluster to define the versions of API for the custom resource.
Each version of the custom resource API can define its own schema for that version.
Kubernetes clients, including the Strimzi Operators, access the custom resources served by the Kubernetes API server using a URL path (API path), which includes the API version

In 0.22, we still support custom resource version `v1alpha1` for all custom resources and `v1beta1` for `Kafka`, `KafkaConnect`, `KafkaConnectS2I`, `KafkaMirrorMaker`, `KafkaUser`, and `KafkaTopic`.
However, these versions are currently deprecated and will be dropped in the Strimzi 0.23 release.
That's one of the reasons why users have to finish the migration before 0.23.

For the new API version, deprecated custom resource properties have been removed. 
You need to migrate custom resources to the new structure.
For instance, `v1beta2` only supports a new array-based listener configuration and new `metrics` configuration formats from config maps.
`logging` properties have also changed.
For metrics configuration, you now use `metricsConfig` in `spec.kafka` to reference the name of a config map with metrics configuration using the `valueFrom` property.
Same for `logging`, but property name remains same.
In addition, some old unused fields like `tlsSidecar` were removed as well.
All the changes to properties are fully described in our [documentation](https://strimzi.io/docs/operators/latest/full/deploying.html#proc-upgrade-cli-tool-files-str).
You can also see a warning in the custom resource status when the deprecated property is used.

For smooth migration to new custom resources and CRDs version, we provide an `api-conversion` tool. _Note that for proper conversion you need to have Strimzi 0.22 installed with all its CRDs._

### API conversion tool

The `api conversion` tool is shipped with Strimzi 0.22 as a [zip file](https://github.com/strimzi/strimzi-kafka-operator/releases/download/0.22.1/api-conversion-0.22.1.zip) and [tar file](https://github.com/strimzi/strimzi-kafka-operator/releases/download/0.22.1/api-conversion-0.22.1.tar.gz).
After extracting, you will find all the libs needed by the tool in `libs` directory and two scripts for running the tool in the directory `bin`.
The `api-conversion.sh` script is for linux/mac users and `api-conversion.cmd` is for Windows users.

The tool operates in two modes:
* Converting custom resources to `v1beta2`. It can convert resources in yaml files or resource already deployed into Kubernetes cluster.
* Convert CRDs to use `v1beta2` as a stored version and use `v1beta2` in all Strimzi custom resources.

You can use the tool directly from an extracted directory as shown in the example below.

![api-conversion tool help](/assets/images/posts/2021-04-18-api-conversion.png)

#### convert-file

The `convert-file` (`cf`) command updates the YAML file of a custom resource, which is passed using an `-f` or `--file` parameter. It converts the custom resource to new API version and updates the properties into the current structure.
The output is printed to _stdout_, or you can specify an output file with `-o` or `--output` options.
You can also use the `--in-file` option to save changes directly to input file.
For more information, run the `bin/api-conversion.sh cf --help` command.

#### convert-resources

The `convert-resources` (`cr`) command converts custom resources directly in your Kubernetes cluster.
You can use `-a`,`--all-namespaces` or `-n`,`--namespace` options to specify namespace where the resources should be converted.
With `-k`,`--kind` the tool will convert only a specific kind of custom resources.
Or the command can convert multiple kinds.
For instance, to convert `Kafka` and `KafkaTopic` you just need to pass `--kind Kafka --kind KafkaTopic` to the `cr` command.

You can use the `--name` option to specify a custom resource by name.
This option can only be used with `--namespace` and single `--kind` options.
For more information, you can run the `bin/api-conversion.sh cr --help` command.

#### crd-upgrade

The `crd-upgrade` (`crd`) command updates `spec.versions` in the Strimzi CRDs to declare `v1beta2` as the storage API version.
The command also updates the API version of existing custom resources and stores them as `v1beta2`.

Once you upgrade CRDs, you must use only the `v1beta2` version in Strimzi Custom resources.

### Conclusion

In this post we took a brief look at API conversion, which is needed for future Strimzi versions.
You can find further information in our [documentation](https://strimzi.io/docs/operators/0.22.1/full/deploying.html#proc-upgrade-cli-tool-files-str).

