---
layout: post
title: "Deep dive into Apache Kafka storage internals: segments, rolling and retention"
date: 2021-12-09
author: paolo_patierno
---

Everyone who uses Apache Kafka knows that it behaves as a commit-log when it comes to deal with storing records.
All records are appended at the end of each log one after the other.
Each log is also split in segments in order to deal with older records deletion, achieving better performances and much more.
So, as the log is a logical sequence of records, it is comprised of segments (files) which each store a subsequence of the records.
The broker configuration allows to tweak a lot of parameters related to logs like the ones about rolling segments, records retention and so on.

Maybe not everyone knows how all these parameters have an impact on the broker behaviour and the expectations that we can have in terms of storing records for longer time and making them available to consumers.
In this blog post, we will dig more into details about how the log segments configuration and records retention work, in order to help making better decisions depending on every single use-case.

<!--more-->

## The topic partition structure on the disk

An Apache Kafka topic is made up by partitions where the records are appended to.
Each partition can be defined the unit of work because it is used by clients to exchange records but cannot be defined as the unit of storage.
A partition is further split into segments which are the actual files on the disk.
This splitting is really important for having better performance when it comes to delete records on disk or when a consumer starts to consume from a specific offset: in both cases, dealing with a single big file is slow and error prone.

Looking at the broker disk, each topic partition is a directory containing the corresponding segment files and some others.
Using the Strimzi Canary component with its producer and consumer as an example, following how a directory looks like.


```shell
├── __strimzi_canary-0
│   ├── 00000000000000000000.index
│   ├── 00000000000000000000.log
│   ├── 00000000000000000000.timeindex
│   ├── 00000000000000000109.index
│   ├── 00000000000000000109.log
│   ├── 00000000000000000109.snapshot
│   ├── 00000000000000000109.timeindex
```

Above, the partition 0 of the topic `__strimzi_canary` used by the Strimzi Canary component; the folder contains the following files:

* The `.log` file is an actual segment containing records up to a specific offset. The name of the file defines the starting offset of the records in that log.
* The `.index` file contains an index that maps logical offset (in effect the record's id) to the byte offset of the record within the `.log` file. It is used for accessing records at specified offsets in the log without having to scan the whole `.log` file.
* The `.timeindex` file is another index used for accessing records by timestamp in the log.

Still using the Strimzi Canary component as an example, following a more detailed view of the previous topic partition folder.

```shell
drwxrwxr-x.  2 ppatiern ppatiern      200 Nov 14 16:33 .
drwxrwxr-x. 55 ppatiern ppatiern     1220 Nov 14 16:33 ..
-rw-rw-r--.  1 ppatiern ppatiern       24 Nov 14 16:33 00000000000000000000.index
-rw-rw-r--.  1 ppatiern ppatiern    16314 Nov 14 16:33 00000000000000000000.log
-rw-rw-r--.  1 ppatiern ppatiern       48 Nov 14 16:33 00000000000000000000.timeindex
-rw-rw-r--.  1 ppatiern ppatiern 10485760 Nov 14 16:33 00000000000000000109.index
-rw-rw-r--.  1 ppatiern ppatiern      450 Nov 14 16:33 00000000000000000109.log
-rw-rw-r--.  1 ppatiern ppatiern       10 Nov 14 16:33 00000000000000000109.snapshot
-rw-rw-r--.  1 ppatiern ppatiern 10485756 Nov 14 16:33 00000000000000000109.timeindex
-rw-rw-r--.  1 ppatiern ppatiern        8 Nov 14 16:24 leader-epoch-checkpoint
```

In the output above, there is the first log segment `00000000000000000000.log` containing records from offset 0 up to offset 108.
The second segment `00000000000000000109.log` is the one containing records starting from offset 109 and it is called the "active segment".

![Log Segments](/assets/images/posts/2021-12-09-segments.png)

The "active segment" is the only file which is opened for both read and write. It is the one where the new incoming records are appended; there is always only one active segment per partition.
Non-active segments are open for read only, and will be accessed by consumers reading older records.
When the active segment becomes full (according to some criteria for full) it is "rolled", which means it is closed and re-opened in read-only mode, and a new segment file is created, opened in read-write mode and becomes the active segment.

As you can see, the old segment was closed when it reached 16314 byes in size and it is because of the canary topic configuration `segment.bytes=16384` setting its maximum size which we'll talk about later.
It shows that each segment is going to contain 109 records, because 109 * 150 bytes = 16350 bytes which is around the closed segment size where 150 byes is the size of every single record sent by the canary.

## How does indexing work within a partition?

As already mentioned previously, the `.index` file contains an index that maps logical offset (in effect the record's id) to the byte offset of the record within the `.log` file.
You could expect that this mapping is available for each record but it doesn't work this way.
Let's consider the record sent by the canary application which is around 150 bytes in size; in the following picture, for 85 records stored in the log file, the corresponding index has just 3 entries.

![Log Index](/assets/images/posts/2021-12-09-index.png)

The record with offset 28 is at byte offset 4169 in the log file, the record with offset 56 is at byte offset 8364 and so on.

```shell
bin/kafka-run-class.sh kafka.tools.DumpLogSegments --deep-iteration --print-data-log --files /tmp/kafka-logs-0/__strimzi_canary-0/00000000000000000000.index
Dumping /tmp/kafka-logs-0/__strimzi_canary-0/00000000000000000000.index
offset: 28 position: 4169
offset: 56 position: 8364
offset: 84 position: 12564
```

How this entries are added inside the index file is defined by the `log.index.interval.bytes` parameter which is 4096 bytes by default.
It means that every 4096 bytes of records added in the log file, an entry is added in the corresponding index file.
Each entry is 8 bytes in size, 4 for the offset and 4 for the bytes position in the segment.
In this example, we have a new index entry added every 28 records because 28 * 150 = 4200.

It means that if a consumer wants to read starting at specific offset, the search of the record will be done with the following steps:

* searching for the `.index` file based on its name which follows the same patterns as the corresponding `.log` file; it contains the starting offset of the records indexed by that index. (TBD: is it a dichotomic/binary search?)
* searching for the entry of the `.index` file where the requested offset falls. (TBD: is it a dichotomic/binary search?)
* using the corresponding bytes offset to access the `.log` file and searching for the offset that the consumer wants to start from. (TBD: is it a sequential search?)

The `log.index.interval.bytes` can be tuned to be faster on searching for records despite the index file growing more or viceversa.
If you set the above parameter less than the default 4096 bytes, you will have more entries in the index to be more fine grained during the search but with more entries so causing the file growing faster as well.
Setting the parameter above the default 4096 bytes means creating less entries in the index so being slower during the search but having the file growing slower as well.

Apache Kafka also allows to start consuming records based on timestamp; this is when `.timeindex` comes into the picture.
Each entry in this file defines a pair made by timestamp and offset to point into the corresponding `.index` file entry.

![Log Timeindex](/assets/images/posts/2021-12-09-timeindex.png)

From the above picture, the records from timestamp `1638100314372` start at offset 28, the ones from `1638100454372` at offset 56 and so on.
Each entry is 12 bytes in size, 8 for the timestamp and 4 for the offset.
It reflects exactly how the Strimzi Canary component is producing records, because it's sending one record every 5 seconds so 28 records would be sent in 28 x 5 = 140 seconds which is exactly the difference 1638100454372 - 1638100314372 = 140000 milliseconds.

```shell
bin/kafka-run-class.sh kafka.tools.DumpLogSegments --deep-iteration --print-data-log --files /tmp/kafka-logs-0/__strimzi_canary-0/00000000000000000000.timeindex 
Dumping /tmp/kafka-logs-0/__strimzi_canary-0/00000000000000000000.timeindex
timestamp: 1638100314372 offset: 28
timestamp: 1638100454372 offset: 56
timestamp: 1638100594371 offset: 84
```

## Let's talk about rolling segments

A new segment will be rolled when some specific conditions are met.
One of them is when the segment maximum size specified by the configuration parameter `log.segment.bytes` (1 GiB by default) is reached.
The second one is based on `log.roll.ms` or `log.roll.hours` (7 days by default) parameters and in this case the segment is rolled when the configured time is elapsed since the producer timestamp of the first record in the segment (or since the creation time if there is no timestamp).
The first target that is met will cause rolling a new segment.
It is also worth noticing that, as a not so usual use case, the producer timestamps in the records could be not ordered, so not having the older record as the first one, due to retries or the specific business logic of the producer.

Another useful parameter is `log.roll.jitter.ms` which is used to add a jitter when it's time to roll a segment, to avoid that many segments are rolled at same time causing high contention on the disk.
A jitter is randomly generated for each segment and the parameter above defines the maximum value.

The above conditions, by size or time, are the well known ones but not everyone knows that there is a third condition.

A segment is rolled even when the corresponding index (or timeindex) is full.
The index and timeindex share the same max size which is defined by the `log.index.size.max.bytes` configuration paraemeter and it is 10 MB by default.
Let's consider the default log segment max size which is 1 GB.
We know that by default, because of `log.index.interval.bytes` is 4096 bytes, an entry is added in the index every 4096 bytes of records.
It means that for a 1 GB segment size, 1 GB / 4096 bytes = 262144 entries are added to the index which leades to 2 MB of index (262144 * 8 bytes).
The dafault index size of 10 MB is enough to handle a segment size of 5 GB.
It means that reducing the index size or increasing the segment size, will drive to have a new segment rolled when the index will be full and not when the requested segment size will be reached.
So setting a segment size larger than 5 GB without increasing the index size is useless, because anyway the broker will roll a new segment when the index is full.

You should take into account that increasing the segment size over 5 GB would need to increase the index file size as well; at same time if you decide for any reasons to reduce the index file size, take into account to decrease the segment size as well.

It is worth mentioning that the timeindex could be a problem as well mostly because each entry is 1.5x bigger than the one in the index (12 bytes versus 8 bytes), so it could be filled up earlier causing a new segment being rolled.

Finally, all these parameters can be set at broker level but they can also be overridden at topic level.

## How long my records are retained? Longer than you expect!

Another important aspect is about until when the older records are retained on the disk before being deleted.
This is configurable in the same way specifying the maximumg number of bytes to retain by using the `log.retention.bytes` parameter or the amount of time that records should be retained by using one of the `log.retention.ms`, `log.retention.minutes` or `log.retention.hours` (7 days by default) parameters.
Even in this case, the first target that is met will cause deletion of older records from the disk.

These parameters can be set at broker level but they can also be overridden at topic level.

Suppose to configure the Strimzi canary topic specifying a retention time of 600000 ms (10 mins) and a segment size of 16384 bytes, using the `TOPIC_CONFIG` environment variable set as `retention.ms=600000;segment.bytes=16384`.

With this configuration, the expection is that a new segment is rolled every time the current active one reaches 16384 bytes in size.
Of course, it will be not so precise because when the active segment is almost full, it can happen that the next record cannot be stored in it, because it would overcome the maximum segment size, so a new segment is rolled earlier.
The canary records are about 150 bytes in size, so the expectation is to store about 16384 / 150 = 109 records per segment before it is closed.
Assuming that the canary is configured to produce records every 5 seconds, the segment will be filled in 109 * 5 = 545 seconds so a new segment will be rolled every 9 minutes.

Regarding the retention, the expectation would be that the records are retained for 10 minutes and then they are deleted but this isn't actually so simple.
What's the minimum and maximum time after appending a record that we might still be able to read it?

A segment, together with the records it contains, can be deleted only when it is closed.
It means that if the producer is pretty slow and the maximum size of 16384 bytes is not reached within the 10 minutes, the older records won't be anyway deleted so our retention will be higher than what we meant to be.

Even if the active segment is filled pretty quickly, the retention time is evaluated starting from the last record appended to the segment itself, right before it is closed.
It means that the latest record will be retained for the 10 minutes we want but the first records in the segment will be retained more; of course it depends how quickly the segment was filled so how much time passed between the first record and the last one.

In our canary related example, the segment will take 9 minutes to be filled and closed, so when the last record comes, the first one in the segment is already 9 minutes old; while waiting for the 10 minutes retention since the last record, the first record "should be" deleted after 19 minutes.

Anyway, even when we think that finally the retention time is evaluated after the last record, it could be still there!
The reason is related to an Apache Kafka thread which runs periodically on the broker to clean records and checking which closed segment can be deleted. The `log.retention.check.interval.ms` is the parameter to configure the period for this thread to run and it defaults to 5 minutes.
Depending on when the last record is appended in the segment, so the segment is closed and when the thread run the last time, it could miss the 10 minutes deadline of the retention and so deleting the closed segment later, so maybe up to almost 5 minutes delay.

In our example, it could happen that the first record in the segment could live up to almost 24 minutes!

Assuming that at some point the clean thread runs and verify that a closed segment can be deleted, initially it just change extensions of corresponding files by adding the `.deleted` extension but not actually deleting the segment from the file system.
There is another broker parameter `log.segment.delete.delay.ms` (1 minute by default) which defines when the file will be actually cancelled from the file system when it's marked as "deleted".

![Total Retention Time](/assets/images/posts/2021-12-09-total-retention-time.png)

Coming back to the canary example again and adding the delay on deletion, the first record in a segment is still alive after 25 minutes!
It is really longer than the 10 minutes expectation, isn't it?

From the above, it is clear that the retention mechanism doesn't really match the initial expectation.
In reality, a record could live even longer than our 10 minutes depending on a lot of other configuration and internal mechanics of the broker.
The usual retention limits set by using `log.retention.ms` defines a kind of lower bound; Kafka guarantees it will not delete any records that have an age less than the one specified, but any older records could get deleted at any time in the future depending on different settings.

It is also worth to mention how it has an impact on the consumer side.
Consumers don't get records from closed segment as well as from deleted segment even if they are just marked as "deleted" but not actually removed from the file system.
This is true even when a consumer starts to read the partition from the beginning.
Longer retention won't have a direct impact on the consumers but more on the disk usage.

It is worth mentioning that the overall retention mechanism works this way when the `log.cleanup.policy` is set to `delete`.
For `compact`ed topics, it is completely different as you can read about on the official Strimzi documentation [here](https://strimzi.io/docs/operators/latest/using.html#removing_log_data_with_cleanup_policies).

## Conclusion

Be aware of how the broker stores partitions and corresponding records on the disk is really important.
A lot of configuration parameters can influence how long your data are retained and quite often it's different from your expectation.
Tweaking all these parameters can be really tricky but gives you more power on handling your data.