module.exports = {
  stale_target_jobs: {
    desc: 'Is target job queue devoid of stale (15-min) jobs?',
    type: 'staleKsuidKeys',
    params: {
      path: `/bookmarks/services/target/jobs`,
      maxage: 15 * 1000 * 60, // 15 mins
    },
  },

  staging_clean: {
    desc: 'Does asn-staging have any stale (5-min) ksuid keys?',
    type: 'staleKsuidKeys',
    params: {
      path: `/bookmarks/trellisfw/asn-staging`,
      maxage: 5 * 1000 * 60, // 5 mins
    },
  },

  jobs_current: {
    desc: 'Is the last modified on the target job queue within 15 mins of asns list?',
    type: 'relativeAge',
    params: {
      leader: `/bookmarks/trellisfw/asns`,
      follower: `/bookmarks/services/target/jobs`,
      maxage: 15 * 1000 * 60,
    },
  },

  count_asns_today: {
    desc: "Count number of ASNs received in today's day-index",
    type: 'countKeys',
    params: {
      path: `/bookmarks/trellisfw/asns`,
      index: `day-index`, // tells it to count keys in this known typeof index instead of path
    },
  },
};
