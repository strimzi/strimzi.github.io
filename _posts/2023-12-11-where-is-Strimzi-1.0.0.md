---
layout: post
title:  "Where is Strimzi 1.0.0?"
date: 2023-12-11
author: jakub_scholz
---

If you have been using Strimzi for some time, you might be wondering about its versioning.
Why does Strimzi still have only some _zero-dot-something_ versions?
Where is Strimzi 1.0.0?
In this blog post, we will look at the history behind this and outline our latest plans for the 1.0.0 release.

_This blog post is a personal opinion of the author and might not represent the view of the whole Strimzi community._

<!--more-->

### The history

Strimzi is almost 6 years old.
For a software project, 6 years is not a _short time_.
When we initially started it, we started it _boldly_.
Our first version was not called 0.0.1 but 0.1.0.
The 0.1.0 release was not yet based on the operator pattern.
That came only with the 0.2.0 release.
0.1.0 was just a bunch of YAML files to make it easier to deploy Apache Kafka.

Neither 0.1.0 nor 0.2.0 were of course production-ready.
They were just the first steps on a long road.
With each subsequent release, we incorporated additional features, addressed bugs, and implemented improvements.
Before we knew it, we welcomed our first production users, and companies began offering commercial products built on Strimzi.
With more and more users, we started thinking about releasing Strimzi 1.0.0.

But there was a thing on the horizon ... the _ZooKeeper-less Apache Kafka_ (also called _KRaft mode_).
The [KIP-500](https://cwiki.apache.org/confluence/display/KAFKA/KIP-500%3A+Replace+ZooKeeper+with+a+Self-Managed+Metadata+Quorum) proposal to replace ZooKeeper was published in August 2019.
Even before this KIP was published, we were aware of plans to alter the dependency on Apache ZooKeeper.
Everyone knew that removing ZooKeeper from Kafka would not be a simple task.
We knew that it would take a long time and mean many different changes.
Changes to Apache Kafka, its Admin API and the way it is managed and configured.
But also changes to Strimzi.
For example, without ZooKeeper, the layout of our `Kafka` custom resource with its dedicated `.spec.kafka` and `.spec.zookeeper` sections does not make sense anymore.
So we decided to not release Strimzi 1.0.0 and wait for the ZooKeeper removal process to be completed.

It turned out that the ZooKeeper removal from Apache Kafka took longer than we initially expected.
In fact, the process is still underway, though it seems like it is slowly coming to an end.
Hopefully, next year will see the release of Apache Kafka 4.0 without ZooKeeper support.
At the time of writing this blog post, Strimzi has 0.38.0 as its last release.
That means 38 versions without releasing 1.0.0.

So, looking back, the decision we took a long time ago was probably a mistake.
If I had the chance to go back and change it, I would surely propose to do the 1.0.0 release already back then and now we would be talking only about _when to do the 2.0.0 release_.

### Does it mean Strimzi is not production-ready?

Does the current versioning mean Strimzi is not production-ready?
No, absolutely not!
We realize the 0.x version might seem concerning and might deter some people.
However, the version number itself does not say much about the project maturity or about how good the project is.
Strimzi is production-ready!
And you can check some of our production users on our [website](https://strimzi.io/) or in our [`ADOPTERS.md` file](https://github.com/strimzi/strimzi-kafka-operator/blob/main/ADOPTERS.md) as proof.

And despite being only at 0.x version, we do our best to maintain backward compatibility on the API level as well in how the Strimzi operators work.
So you should not have anything to worry about!

### How do we get out of it?

So what is the plan for Strimzi 1.0.0?
When we realized that the ZooKeeper removal would take much longer than originally anticipated, we had two options.
Change our mind and release 1.0.0.
Or stick with our decision.
And since the KRaft implementation was progressing in the Apache Kafka community and it seemed to be closer and closer, we decided to stick to our decision.
Maybe that was another mistake, who knows?
Things always seem like they are almost there.

But hopefully, the _next year_ will really be the **next year** when it happens.
If everything goes according to the _latest_ plans, Apache Kafka 4.0 without ZooKeeper support will be released in 2024.
Once it is released and supported by Strimzi, we will proceed and update the `Kafka` custom resource to reflect this change.
The updated `Kafka` resource will be used for the Strimzi `v1` API.
And the `v1` API will be hopefully soon followed by the Strimzi 1.0.0 release.
This might take another few months to stabilize the APIs, catch the last bugs and so on.
So depending on when the Kafka 4.0.0 release happens, it might not be 2024 anymore.
But then we will be finally there - at version 1.0.0.

### Learning from our mistakes

To be clear, this blog post is not intended in any way to blame the Apache Kafka community for how long it takes to remove ZooKeeper from Kafka.
Any decisions about the Strimzi 1.0.0 release and any expectations about how long will ZooKeeper removal take were only our own.
Hopefully, it will instead make it clearer why we still do only some 0.x release and when to expect the Strimzi 1.0.0 release.
And it should also make you less afraid of using it despite the version still starting with a zero.
And help you learn from our mistakes!
