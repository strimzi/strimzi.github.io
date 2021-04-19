---
layout: post
title:  "Upgrade procedure improvements"
date: 2021-04-07
author: jakub_stejskal
---
Upgrade process of Strimzi and Kafka is not trivial. 
In Strimzi 0.22 we introduced several improvements, which will make the process easier for the users. 
This blog post will show you how the upgrade process changed and what you should do to keep your cluster working without issues.

<!--more-->

### Upgrade improvements

Legacy upgrade process was a little complicated.
Users had to have fill Kafka `version`, but also `log.message.format.version` or `inter.broker.protocol.version` before the upgrade.
This makes the upgrades hard to execute fully automatically for example when you use Strimzi installed from [OperatorHub](https://operatorhub.io/operator/strimzi-kafka-operator).
You also needed to upgrade through all versions of Strimzi and Kafka.
For example if you wanted to upgrade from 0.18 to 0.20, the recommended approach was to install 0.19 firstly and then do the same steps for 0.20.

Now, the process is a bit more friendly.
Strimzi now does the following things regarding Kafka configuration:
* detect used Kafka `version`, `log.message.format.version` and `inter.broker.protocol.version` (from CR or compute it from Kafka `version`)
* configure Kafka `version`, `log.message.format.version` and `inter.broker.protocol.version` if it's not specified by user

The main improvement is, that you don't need to upgrade across all Strimzi versions, but you can upgrade from for instance 0.18 directly to 0.22 as it is shown in the diagram bellow.
You can face the following states:
* Supported Kafka `version` and `log.message.format.version` or `inter.broker.protocol.version` is set in CR - Strimzi will keep the values and missing one will se based on `version`.
* Supported Kafka `version` is set, `log.message.format.version` and `inter.broker.protocol.version` are not set in CR - Strimzi will set `log.message.format.version` and `inter.broker.protocol.version` based on `version`
* Supported Kafka `version` is not set in CR - Strimzi will set Kafka `version`, `log.message.format.version` and `inter.broker.protocol.version` based on the default Kafka supported in 0.22.
* Unsupported Kafka `version` is set in CR - Strimzi will set `Kafka` CR status to `NotReady`. 
  In that case user has to update CR and manually set a proper config.

![Upgrade improvements diagram](/assets/images/posts/2021-04-16-upgrade-improvements.png)

Even with these changes, there are still some disadvantages:
* For upgrade, roll out the new brokers while first using the older `log.message.format.version` or `inter.broker.protocol.version` and only afterwards change to the new versions for message format and inter-broker protocol.
* Downgrade won't be executed when new `log.message.format.version` or `inter.broker.protocol.version` are already used.
You need to change configuration to use same or older1 `log.message.format.version` and `inter.broker.protocol.version` as older Kafka.

### Conclusion

In this blog post we went through recent upgrade-related changes introduced in Strimzi 0.22.
You can find further information in our [documentation](https://strimzi.io/docs/operators/0.22.1/full/deploying.html#assembly-upgrade-str).

