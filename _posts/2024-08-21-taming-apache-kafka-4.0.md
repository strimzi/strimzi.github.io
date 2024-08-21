---
layout: post
title:  "Taming Apache Kafka 4.0"
date: 2024-08-21
author: jakub_scholz
---

The Apache Kafka 4.0 release is just around the corner.
It will be a very significant release for Apache Kafka.
But it will also have a huge impact on Strimzi.
Therefore in this blog post, we will look closer at what changes Apache Kafka 4.0 will bring, when is it currently planned to be released, and how it will be supported by Strimzi.

<!--more-->

### Why is Apache Kafka 4.0 so impactful for Strimzi

New major releases often bring a lot of changes, remove old deprecated APIs, and so on.
And Apache Kafka 4.0 won't be different.
But unlike the previous Apache Kafka major releases that Strimzi went through and which had only minimal impact on us, Kafka 4.0 will have also some changes with a huge impact on Strimzi:

* Kafka 4.0 will not support ZooKeeper-based Apache Kafka clusters anymore.
  The only way how to run a Kafka cluster will be by using KRaft.
  This means that all existing ZooKeeper-based clusters will need to be migrated to KRaft before upgrading to Apache Kafka 4.0.
* MirrorMaker 1 was already deprecated in Kafka 3.0 and it will be completely removed in Kafka 4.0.
  You will need to migrate to MirrorMaker 2 or some other mirroring tool of your choice before upgrading to Kafka 4.0.
* Logging in the Kafka components is moving from the Log4j1 (Reload4j) APIs to Log4j2.

These changes have a big impact on Strimzi and its code base.
But also on all Strimzi users.
So we need to make sure we are properly prepared for them.

#### When will Apache Kafka 4.0 be released

The Apache Kafka project just released Kafka 3.8.0.
Before releasing Kafka 4.0, it is planned to do one more minor release.
This will be the 3.9.0 release, which should be done in a shorter release cycle than the usual 4 months.
And then, the 4.0.0 release will come.

The currently expected timeline is:
* 3.9.0 release in August or September
* 4.0.0 release at the end of 2024 or early 2025

But as with any plans and timelines, this may still change.
The planned release dates might be moved.
And - although unlikely - it might even happen that another minor release has to be done before releasing Kafka 4.0.
So keep this in mind when reading this blog post.

### How will Strimzi handle Kafka 4.0 changes

Because of these changes and their impact on Strimzi, we needed to have a clear plan for how to adopt Kafka 4.0.
Strimzi always supports at least the two latest Apache Kafka minor versions.
If we follow this approach, we would have at least one Strimzi version with support for both Kafka 3.9 which still supports all the old features and Kafka 4.0 which would have already dropped the support.
So, how will we deal with it?
Will we break the tradition and have a Strimzi version supporting only one Apache Kafka version - in this case 4.0?
Or will we adapt Strimzi to handle the two Kafka versions with very different feature sets?

To decide and plan things like this in Strimzi, we use _Strimzi proposals_.
You can find all our proposals in the [GitHub repository](https://github.com/strimzi/proposals).
And if you are interested in what might come in the future, you can always check the PRs with the upcoming proposals and comment on them.

In this case, the two relevant proposals are the ones with numbers 77 and 79 that were approved in July:
* [#77: Support for Apache Kafka 4.0](https://github.com/strimzi/proposals/blob/main/077-support-for-kafka-4.0.md)
* [#79: Removal of MirrorMaker 1](https://github.com/strimzi/proposals/blob/main/079-removal-of-mirror-maker-1.md)

Let's have a look in a bit more detail at what they say and what the plans look like.

#### ZooKeeper support

As already explained in one of the previous sections, the current expectation is that the last Apache Kafka release with Apache ZooKeeper support will be Kafka 3.9.
Once it is released, Strimzi will release a new version with support for Apache Kafka 3.8 and 3.9.
Depending on the exact timing, there might be two such Strimzi versions:
* One version (let's call it `0.4x`) soon after the Kafka 3.9 release
* Another one (let's call it `0.4y`) approximately 1-2 months later

Kafka 3.9 is expected to address at least some of the remaining KRaft issues.
In particular, it should add support for controller scaling.
So in these Strimzi versions, we will try to add support for the new KRaft features.
The `0.4y` will be the last version that will allow you to run ZooKeeper-based Kafka clusters and let you migrate to KRaft.

The next Strimzi version (let's call it `0.4z`) that will follow will already focus on Kafka 4.0 and will completely remove the ZooKeeper support.
It will still keep the support for Kafka 3.9 to make the upgrades easier.
But even with Kafka 3.9, it will let you use KRaft-based Kafka clusters only.
That means that to upgrade to Strimzi `0.4z`, you will need to be already using KRaft.

The ZooKeeper to KRaft migration has been already supported by Strimzi for some time.
So while you do not have to migrate right now, you can give it a try, get an idea of how it works, and help us test it today.
You can read more about it in our [blog post about KRaft migration](https://strimzi.io/blog/2024/03/22/strimzi-kraft-migration/).

If you don't migrate your Kafka cluster to KRaft before upgrading to Strimzi `0.4z`, Strimzi will not delete or damage the Kafka cluster.
But it will not be able to operate such a cluster.
So, you will need to either delete the cluster and create a new one based on KRaft, or downgrade Strimzi and then migrate the cluster to KRaft.

The following table provides an overview of the different versions and their support for ZooKeeper and KRaft:

| Version | Supported Kafka versions | ZooKeeper supported | KRaft supported |
| :-----: |:-------------------------|:--------------------|:----------------|
| ...     | 3.7.x, 3.8.x             | yes                 | yes             |
| 0.4x    | 3.8.x, 3.9.x             | yes                 | yes             |
| 0.4y    | 3.8.x, 3.9.x             | yes                 | yes             |
| 0.4z    | 3.9.x, 4.0.x             | no                  | yes             |
| ...     | 4.0.x, 4.1.x             | no                  | yes             |

For more details and other alternatives we considered, please check out the [_Support for Apache Kafka 4.0_](https://github.com/strimzi/proposals/blob/main/077-support-for-kafka-4.0.md) proposal.

#### MirrorMaker 1 removal

To make things easier to remember, we decided to remove the support for MirrorMaker 1 using the same schedule as we have for the ZooKeeper support removal.
So the `0.4y` version will be the last Strimzi version with support for MirrorMaker 1.

While many different mirroring tools for Apache Kafka can replace MirrorMaker 1, the most obvious choice is MirrorMaker 2.
MirrorMaker 2 has been part of the Apache Kafka project already for a long time and was from the beginning developed as an improved replacement and successor of MirrorMaker 1.
It is also supported by Strimzi since Strimzi 0.17.
While the MirrorMaker 2 architecture is completely different from MirrorMaker 1, it can be configured to work similarly by using the `IdentityReplicationPolicy`.
But it has also many new features that you should consider while migrating from MirrorMaker 1.
For example better support for active-active mirroring or mirroring of committed consumer group offsets.

Strimzi will not provide any automatic migration from MirrorMaker 1 to MirrorMaker 2.
There are several reasons why such automatic migration would not be feasible:
* Monitoring of MirrorMaker 2 is different from MirrorMaker 1 (different dashboards, alerts, etc.)
* MirrorMaker 2 is based on Kafka Connect, connectors managing the transfer of data between clusters, so it requires additional topics, configurations and access rights.
  In particular, automatically finding the correct configuration for the Connect cluster that will not conflict with other clusters or ensuring the users have the required privileges might be very complicated.
  Also, the resource requirements for MirrorMaker 1 and MirrorMaker 2 might differ.
* It might not be possible to ensure a smooth transition without any message loss or duplicate messages.

So if you still use MirrorMaker 1, you should migrate to MirrorMaker 2 before upgrading to Strimzi `0.4z`.
If you have any MirrorMaker 1 cluster deployed and running when you upgrade to Strimzi `0.4z`, Strimzi will not delete this cluster.
But it will not be able to operate such a cluster either and it will just ignore it.

The following table provides an overview of the different versions and their support for MirrorMaker 1 and 2:

| Version | Supported Kafka versions | MM1 support | MM2 support |
| :-----: |:-------------------------|:------------|:------------|
| ...     | 3.7.x, 3.8.x             | yes         | yes         |
| 0.4x    | 3.8.x, 3.9.x             | yes         | yes         |
| 0.4y    | 3.8.x, 3.9.x             | yes         | yes         |
| 0.4z    | 3.9.x, 4.0.x             | no          | yes         |
| ...     | 4.0.x, 4.1.x             | no          | yes         |

For more details and other alternatives we considered, please check out the [_Removal of MirrorMaker 1_](https://github.com/strimzi/proposals/blob/main/079-removal-of-mirror-maker-1.md) proposal.

#### Other changes

##### Log4j2

One of the other changes in Apache Kafka 4.0 will be the change of the logging library used by the Kafka components.
The Kafka brokers and Connect nodes will move from Log4j1 (Reload4j) to Log4j2.
We currently do not expect this change to have any impact on the Strimzi API.
But if you use some custom logging configurations, you might need to update the names of the loggers or the logging configuration file to a new format as part of the upgrade to Kafka 4.0.

##### Removal of storage overrides

While this change is not directly related to Kafka 4.0, we decided to use the disruption caused by the other changes to also deprecate and remove support of the [_Storage class overrides_](https://strimzi.io/docs/operators/0.42.0/full/deploying.html#storage_class_overrides).
They are deprecated as of Strimzi 0.43.0.
And they will be completely ignored in Strimzi `0.4z`.
If you are using storage class overrides today, you can replace them by using multiple node pools, each with a different storage class.
This change will allow us to simplify the code and the Strimzi API.
That will make Strimzi easier to maintain and add more new features.

### Not ready for it yet?

We are well aware that many Apache Kafka users are reluctant to move to KRaft just yet.
So we will try to provide _extended support_ for the Strimzi `0.4y` release.
That should make it easier for users who want to stick with ZooKeeper or MirrorMaker 1 for a bit longer.
What does _extended support_ mean?
Where possible, it includes:
* Addressing any critical Common Vulnerabilities and Exposures (CVEs) that arise.
* Aiming to support any new patch releases of Apache Kafka 3.9.
* Continuing to fix critical bugs related to ZooKeeper, KRaft, and the migration process from ZooKeeper to KRaft.

We will try to do this for one year after the initial Kafka 3.9 is released, which is the same time for which the Apache Kafka project plans to support the 3.9 release.
Unfortunately, sometimes, even seemingly straightforward tasks such as updating a dependency to address a CVE can lead to major code changes.
That’s why the phrase _where possible_ is important. 
While we will try to address these issues, there may be cases where it’s not feasible to do so with reasonable effort due to the complexity of the changes required.
We also do not plan to add any new features to Strimzi as part of `0.4y` patch releases.
You should also keep in mind that regardless of how long you wait on Strimzi `0.4y`, you will in the end always need to first migrate to KRaft with Strimzi `0.4y` and Apache Kafka 3.9 before upgrading to any newer Kafka or Strimzi version.

### Conclusion

Hopefully, this blog post gives you a better idea of what to expect from Apache Kafka 4.0 and what to plan for.
Based on the current plans:
* Strimzi `0.4x` release might be Strimzi 0.44
* Strimzi `0.4y` release might be Strimzi 0.45
* Strimzi `0.4z` release might be Strimzi 0.46

But remember, _no plan survives the first contact with the reality_.
So all of this is subject to change.
And especially when it comes to the exact release versions and timelines, it is not just up to Strimzi, but also up to the Apache Kafka project to how much they change.
So make sure you follow the usual Strimzi channels such as Slack, Twitter, GitHub, or our mailing lists for the latest updates.
