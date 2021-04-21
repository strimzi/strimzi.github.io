---
layout: post
title:  "Kafka upgrade improvements"
date: 2021-04-07
author: jakub_stejskal
---
Upgrade process of Strimzi and Kafka is not trivial. 
In Strimzi 0.22 we introduced several improvements, which will make the process easier for the users. 
This blog post will show you how the upgrade process changed and what you should do to keep your cluster working without issues.

<!--more-->

### Upgrade improvements

Upgrade process before 0.22 consisted of multiple steps.
During upgrade, users had to go through all already released versions between current deployed version and target one.
For example if you wanted to upgrade from 0.18 to 0.20, the recommended approach was to install 0.19 firstly, wait for rolling-update, set new values for Kafka `version`, `log.message.format.version` and `inter.broker.protocol.version` and then do the same steps for 0.20.
This makes the upgrades hard to execute fully automatically for example when you use Strimzi installed from [OperatorHub](https://operatorhub.io/operator/strimzi-kafka-operator).
The rolling update of Kafka cluster is also time-consuming, so upgrade through several versions can take a long time.

#### Process changes

Now, the process is a bit more friendly.
The main improvement is, that you don't need to upgrade across all Strimzi versions, but you can upgrade from for instance 0.18 directly to 0.22 as it is shown in the diagram bellow.
You can face the following states:
* Supported Kafka `version` and `log.message.format.version` or `inter.broker.protocol.version` is set in CR - Strimzi will keep the values and missing one will se based on `version`.
* Supported Kafka `version` is set, `log.message.format.version` and `inter.broker.protocol.version` are not set in CR - Strimzi will set `log.message.format.version` and `inter.broker.protocol.version` based on `version`
* Supported Kafka `version` is not set in CR - Strimzi will set Kafka `version`, `log.message.format.version` and `inter.broker.protocol.version` based on the default Kafka supported in 0.22.
* Unsupported Kafka `version` is set in CR - Strimzi will set `Kafka` CR status to `NotReady`. 
  In that case user has to update CR and manually set a proper config.

Strimzi now does the following things regarding Kafka configuration:
* Detect used Kafka `version`, `log.message.format.version` and `inter.broker.protocol.version` (from CR or compute it from Kafka `version`).
* Configure Kafka `version`, `log.message.format.version` and `inter.broker.protocol.version` if it's not specified by user.

Users don't need to fill Kafka `version`, but also `log.message.format.version` or `inter.broker.protocol.version` before the upgrade, but we strongly recommend it.

#### Upgrade without versions

Strimzi is able to deal with upgrade of Kafka clusters where versions are not set in custom resource.
In cases like that, Strimzi is able to determine the versions and go through the upgrade as follows:
* Get version of currently deployed Kafka and set it in custom resource.
* Perform Kafka cluster rolling update to change the images from old Strimzi version to new one.
* Upgrade Kafka `version` to default version support by new Strimzi version which will perform rolling update.
* Get `log.message.format.version` and `inter.broker.protocol.version` based on `version`.
* Set `log.message.format.version` and `inter.broker.protocol.version` and perform Kafka cluster rolling update.

You can see the states of the upgrade process and each rolling update in the diagram bellow.

![Kafka upgrade states](/assets/images/posts/2021-04-19-kafka-rolling-updates.png)

#### Things to be aware of

Even with these changes, there are still some disadvantages:
* For upgrade, roll out the new brokers while first using the older `log.message.format.version` or `inter.broker.protocol.version` and only afterwards change to the new versions for message format and inter-broker protocol.
* [Downgrade is supported](https://strimzi.io/docs/operators/0.22.1/full/deploying.html#con-target-downgrade-version-str) only when you don't set new versions of `log.message.format.version` and `inter.broker.protocol.version`. 
For instance in case you upgrade to 0.22 from 0.20 and upgrade Kafka to 2.7, working downgrade is not guaranteed in case you set `log.message.format.version` or `inter.broker.protocol.version` to 2.7.
  
### Conclusion

In this blog post we went through recent upgrade-related changes introduced in Strimzi 0.22.
You can find further information in our [documentation](https://strimzi.io/docs/operators/0.22.1/full/deploying.html#assembly-upgrade-str).

