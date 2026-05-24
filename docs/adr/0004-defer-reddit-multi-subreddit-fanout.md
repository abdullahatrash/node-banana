# Defer Reddit Multi-Subreddit Fanout

Node Banana will not copy Postiz's Reddit behavior where one provider settings object can publish a single post to multiple subreddits. For now, a post sent through a Reddit Channel targets one subreddit, preserving the existing one post row to one channel publish result model. Multi-subreddit publishing can be added later as explicit post duplication or destination expansion with clearer partial-failure semantics.
