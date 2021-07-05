---
layout: post
title:  "Kafka upgrade improvements"
date: 2021-07-05
author: jakub_stejskal
---
The upgrade of Strimzi and Kafka is not a trivial process.
In last releases we introduced several improvements to make the process easier.
This post shows you how the upgrade process has changed, and what you should do to keep your cluster working without issues.

<!--more-->

### Upgrade improvements

In the past, the upgrade process required multiple steps.
During upgrade, users had to go through all released versions between the current version and the target version.
For example if you wanted to upgrade from 0.18 to 0.20, the recommended approach was to install 0.19 first, wait for a rolling update, and set new values for Kafka `version`, `log.message.format.version` and `inter.broker.protocol.version`. 
And then repeat the same steps for 0.20.
This made the upgrades hard to execute fully automatically. For example, when installing Strimzi from the [OperatorHub](https://operatorhub.io/operator/strimzi-kafka-operator).
The rolling update of Kafka cluster was also time-consuming, as upgrading through several versions can take a long time.

#### Process changes

Now, the process is a bit more friendly.
The main improvement is you don't need to upgrade across all Strimzi versions, For instance, you can upgrade from version `X` directly to `X+2` without upgrade through any other release like `X+1`.
The upgrade process is shown in the diagram below.

Strimzi now does the following things regarding Kafka configuration:
* Detect used Kafka `version`, `log.message.format.version` and `inter.broker.protocol.version` (from CR or compute it from Kafka `version`).
* Configure Kafka `version`, `log.message.format.version` and `inter.broker.protocol.version` if it's not specified by user.

Here's how Strimzi handles certain situations:
* Supported Kafka `version` and `log.message.format.version` or `inter.broker.protocol.version` is set in CR - Strimzi will keep the values and any missing one will be based on the `version`.
* Supported Kafka `version` is set, `log.message.format.version` and `inter.broker.protocol.version` are not set in CR - Strimzi will set `log.message.format.version` and `inter.broker.protocol.version` based on `version`
* Supported Kafka `version` is not set in CR - Strimzi will set Kafka `version`, `log.message.format.version` and `inter.broker.protocol.version` based on the default Kafka supported by Strimzi.
* Unsupported Kafka `version` is set in CR - Strimzi will set `Kafka` CR status to `NotReady`. 
  In that case user has to update CR and manually set a proper config.

You don't need to configure the Kafka `version`, `log.message.format.version` or `inter.broker.protocol.version` before the upgrade, but we **strongly** recommend it.

#### Upgrade without versions

Strimzi is able to deal with upgrade of Kafka clusters where versions are not set in the custom resource.
In cases like this, Strimzi determines the versions and performs the upgrade as follows:
* Perform a rolling update of the Kafka cluster to change the images from the old Strimzi version to the new one.
* Upgrade the Kafka `version` to the default version supported by the new Strimzi version, which will perform a rolling update if it is not already used.
* Get `log.message.format.version` and `inter.broker.protocol.version` based on `version`.
* Set `inter.broker.protocol.version`, and perform a rolling update of the Kafka cluster.
* Set `log.message.format.version`, and perform a rolling update of the Kafka cluster.

You can see the states of the upgrade process and each rolling update in the diagram below.
_Note that Kafka versions are only for an illustration.
Real Kafka versions should be set based on Strimzi supported ones._

![Kafka upgrade states](/assets/images/posts/2021-07-05-kafka-rolling-updates.png)

#### Things to be aware of

With the introduction of these upgrade improvements, there are a couple of things to be aware of:
* For upgrade, you need to roll out the new brokers while first using the older `log.message.format.version` or `inter.broker.protocol.version`, and only afterwards change to the new versions for message format and inter-broker protocol.
* [Kafka downgrade is supported](https://strimzi.io/docs/operators/0.24.0/full/deploying.html#con-target-downgrade-version-str) only when you don't set new versions of `log.message.format.version` and `inter.broker.protocol.version`. 
For instance, if you've upgraded to Kafka to `x.y.z`, a working downgrade is not guaranteed after you've set `inter.broker.protocol.version` to `x.y`.
* In case you do upgrade from 0.22, you must go through Strimzi CRD upgrade.
For more info see our [documentation](https://strimzi.io/docs/operators/0.22.1/full/deploying.html#assembly-upgrade-resources-str).

### Conclusion

In this post we went through recent upgrade-related changes introduced in Strimzi 0.24.
You can find further information in our [documentation](https://strimzi.io/docs/operators/0.24.0/full/deploying.html#assembly-upgrade-str).

