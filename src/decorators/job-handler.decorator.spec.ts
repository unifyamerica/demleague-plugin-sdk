import { getJobHandlers, JobHandler } from './job-handler.decorator';

describe('@JobHandler', () => {
  it('should find decorated methods, inherited ones included', () => {
    class Base {
      @JobHandler('cleanup')
      cleanup() {}
    }
    class Jobs extends Base {
      @JobHandler('round-end')
      roundEnd() {}

      helper() {}
    }

    expect(getJobHandlers(Jobs)).toEqual([
      { job: 'round-end', methodName: 'roundEnd' },
      { job: 'cleanup', methodName: 'cleanup' },
    ]);
  });

  it('should reject malformed job names', () => {
    expect(() => JobHandler('Round.End')).toThrow('job names');
  });
});
