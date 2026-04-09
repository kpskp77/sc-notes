# Process

按照功能类型共有三种线程：*method process*，*thread process*，和*clocked thread process*。

SC只允许在固定的几个阶段创建process，按照创建的阶段分为：

- *static process*: 在`sc_module`的构造函数，或者`before_end_of_elaboration`的回调函数中创建的线程。
- *dynamic process*: 在`end_of_elaboration`的回调函数，或者Simulation阶段创建的线程。

按照创建的方法分为：

- *unspawned process*: 通过`SC_METHOD`, `SC_THREAD`, `SC_CTHREAD`宏创建的线程，这三个宏不能在Simulation阶段使用。
- *spawned process*: 通过`sc_spawn`创建的线程，可以在允许创建线程的任意阶段使用。

线程启动需要依赖敏感条件被触发，敏感条件分为两类：

- 静态敏感条件（*static sensitivity*）：*unspawned process*创建时通过`sc_module`的`sensitive`指定，或者*spawned process*创建时通过`sc_spawn_options`的`set_sensitivity`指定。
- 动态敏感条件（*dynamic sensitivity*）：线程执行过程中通过调用`wait`（thread process）或者`next_trigger`（method process）指定。

根据[Simulation Scheduling Algorithm](schedule.md#simulation-scheduling-algorithm)，如果创建线程时不显示调用`dont_initialize`，线程的首次启动将由内核主动执行；否则，需要等到其静态敏感条件被触发。

## method process

既可以是*static process*，也可以是*dynamic process*；既可以是*unspawned process*，也可以是*spawned process*。

除了创建线程时可能被内核启动外，在每次满足敏感条件时，内核也会执行一次该method process。method process执行过程中不能被阻塞（因此，不能调用`wait`函数），即，method process每次启动后都会完整执行到函数返回（除非被kill或者reset）。执行过程中可以调用带入参的`next_trigger`函数产生动态敏感条件，动态敏感条件使静态敏感条件失效，下一次执行仅被动态敏感条件触发。执行过程中调用不带入参的`next_trigger`函数将清除所有动态敏感条件，使静态敏感条件重新生效。

## thread process

既可以是*static process*，也可以是*dynamic process*；既可以是*unspawned process*，也可以是*spawned process*。

thread process只能被执行一次，函数返回后该线程被终止（terminated）。要么在创建线程时被内核启动，要么首次满足静态敏感条件时被启动，或者通过reset重新启动。通常，thread process内部是一个死循环，在其中调用`wait`函数来阻塞线程。带入参（除单个整型入参外）的`wait`函数产生动态敏感条件，动态敏感条件使静态敏感条件失效；不带入参的`wait`或者带单个整型入参的`wait`函数将清除所有动态敏感条件，使静态敏感条件重新生效。thread process不允许调用`next_trigger`。

!!! note
    `wait(int n)`等价于连续调用n次`wait()`。

## clocked thread process

是一种特殊的thread process，只能是*static unspawned process*。创建时无论是否调用`dont_initialize`，在Initialization Phase，clocked thread process都不会被添加到*runnable processes集合*。

支持且仅支持单个时钟信号作为静态敏感条件，不支持动态敏感条件（即，只允许调用不带入参的`wait`或者带单个整型入参的`wait`函数）。

*Example*:

```cpp
#define SC_INCLUDE_DYNAMIC_PROCESSES  // needed for sc_spawn
#include <systemc>
using namespace sc_core;
using namespace std;

class test : sc_module {
  sc_event e1;
  sc_event e2;
 public:
  SC_HAS_PROCESS(test);
  test(sc_module_name name) : sc_module(name) {
    SC_METHOD(run1);
    SC_THREAD(run2); sensitive << e1; dont_initialize();
  }
  void run1() {
    cout << sc_time_stamp() << ": method process begin" << endl;
    sc_spawn(sc_bind(&test::run3, this));  // create dynamic spawned thread process
    e1.notify(1, SC_SEC);                  // timed notification
    next_trigger(e2);                      // dynamic sensitivity
    cout << sc_time_stamp() << ": method process end" << endl;
  }
  void run2() {
    while (true) {
      cout << sc_time_stamp() << ": thread process" << endl;
      e2.notify();  // immediate notification
      wait();
    }
  }
  void run3() {
    wait(e2);  // dynamic sensitivity
    cout << sc_time_stamp() << ": dynamic spawned thread process" << endl;
  }
};

int sc_main(int, char*[]) {
  test o_test("o_test");
  sc_start(2, SC_SEC);
  return 0;
}
```
```bash title="Output"
0 s: method process begin
0 s: method process end
1 s: thread process
1 s: method process begin
1 s: method process end
1 s: dynamic spawned thread process
```

## process handle

通过`sc_process_handle`对象可以对process实例实现更复杂的控制。

### `terminated` and `terminated_event`

一个线程如果已经被终止（terminated），对该线程的操作不再生效，并且该线程无法再次被添加到*runnable processes集合*，之后的整个仿真期间内都无法恢复该线程的执行。对于method process，只能通过kill终止；对于thread process，通过kill或者函数返回都能终止该线程。

```cpp
bool terminated() const;
const sc_event& terminated_event() const;
```

一个线程终止后，`terminated`函数返回`true`；`terminated_event`函数返回的`sc_event`对象在线程被终止时被触发。

### `suspend` and `resume`

某个线程被suspend后无法被添加到*runnable processes集合*中，因此不能响应notification或time-out，之后可以通过resume恢复响应。在suspend期间，仿真器内核会监控被suspend线程的notification或time-out。如果suspend期间出现过notification和time-out，调用resume时该线程在当前phase恢复执行（即，在resume被调用的phase将该线程添加到*runnable processes集合*中）。否则，调用resume后，需要等到下一次notification和time-out出现时，被suspend的线程才能恢复执行。

可以在当前线程中suspend自身，也可以suspend其他线程。

- 在某个线程中suspend自身：
    - 对于method process：由于method process无法阻塞线程，在调用`suspend`时不会立即生效，需要整个函数执行完成返回后才生效。后续调用`resume`时，从头开始执行该函数。
    - 对于thread process：在调用`suspend`时立即生效，控制权交还给仿真器内核。后续调用`resume`时，从之前`suspend`位置恢复执行。
- 在某个线程中suspend其他线程：如果该线程已经在*runnable processes集合*中，该线程将从集合中被移除。

*Example*:

```cpp
#include <systemc>
using namespace sc_core;
using namespace std;

struct M1 : sc_module {
  SC_HAS_PROCESS(M1);
  M1(sc_module_name name) : sc_module(name) {
    SC_THREAD(ticker); SC_THREAD(calling); SC_THREAD(target);
    t = sc_get_current_process_handle(); // process handle of `target`
  }
  sc_process_handle t;
  sc_event ev;
  void ticker() { for (;;) { wait(10, SC_NS); ev.notify(); } }
  void calling() {
    // Target runs at time 10 NS due to notification
    wait(15, SC_NS);
    t.suspend();
    // Target does not run at time 20 NS while suspended
    wait(10, SC_NS);
    // Target runs at time 25 NS when resume is called
    t.resume();
    // Target runs at time 30 NS due to notification
    wait(10, SC_NS);
    sc_stop();
  }
  void target() { for (;;) { wait(ev); cout << "Target awoke @" << sc_time_stamp() << endl; } }
};

int sc_main(int argc, char *argv[]) {
  M1 m1("m1");
  sc_start();
  return 0;
}
```
```bash title="Output"
Target awoke @10 ns
Target awoke @25 ns
Target awoke @30 ns
```

### `disable` and `enable`

某个线程被disable后无法被添加到*runnable processes集合*中，因此不能响应其notification或time-out，之后可以通过enable恢复响应。与suspend不同的是，在disable期间，仿真器内核不会监控被disable线程的notification或time-out。

可以在当前线程中disable自身，也可以disable其他线程。

- 在某个线程中disable自身：无论是method process，还是thread process，在调用`disable`时不会立即停止执行，需要执行到`wait`或者函数结束，该线程才被disable。enable后满足notification或time-out时，从`wait`或者函数开头恢复执行。
- 在某个线程中disable其他线程：如果该线程已经在*runnable processes集合*中，该线程不会从集合中被移除。当前phase结束后再disable该线程。

!!! warning
    不能disable一个正在wait time-out的线程。因为disable期间不能响应time-out，仿真器内核也不监控time-out。enable之后可能已经错过time-out，无法恢复执行。

*Example*:

```cpp
#include <systemc>
using namespace sc_core;
using namespace std;

struct M1 : sc_module {
  SC_HAS_PROCESS(M1);
  M1(sc_module_name name) : sc_module(name) {
    SC_THREAD(ticker); SC_THREAD(calling); SC_THREAD(target);
    t = sc_get_current_process_handle(); // process handle of `target`
  }
  sc_process_handle t;
  sc_event ev;
  void ticker() { for (;;) { wait(10, SC_NS); ev.notify(); } }
  void calling() {
    // Target runs at time 10 NS due to notification
    wait(15, SC_NS);
    t.disable();
    // Target does not run at time 20 NS while disabled
    wait(10, SC_NS);
    // Target does not run at time 25 NS when enable is called
    t.enable();
    // Target runs at time 30 NS due to notification
    wait(10, SC_NS);
    sc_stop();
  }
  void target() { for (;;) { wait(ev); cout << "Target awoke @" << sc_time_stamp() << endl; } }
};

int sc_main(int argc, char *argv[])
{
  M1 m1("m1");
  sc_start();
  return 0;
}
```
```bash title="Output"
Target awoke @10 ns
Target awoke @30 ns
```

### `kill` and `reset`

`kill`会立即终止线程执行，并产生`sc_unwind_exception`异常。被kill的线程将会被置于*terminated state*，在之后的仿真阶段将永远无法被执行。

- 在某个线程中kill自身：`kill`函数之后的代码将不会执行，并将控制权交还给仿真器内核。
- 在某个线程中kill其他线程：将该线程从*runnable processes集合*中移除，清空该线程堆栈，然后继续执行caller线程。

reset会立即复位线程执行，并产生`sc_unwind_exception`异常。被reset的线程不会被置于*terminated state*。无论是reset自身还是其他线程，线程被reset时，将其从*runnable processes集合*中移除，清空所有动态敏感条件，并立即重新执行该线程，直到进入wait或者函数返回。此时，控制权将交还给仿真器内核（reset自身）或者caller线程（reset其他线程）。

kill和reset都会产生`sc_unwind_exception`异常，可以通过该exception的成员函数`is_reset`的返回值来区分。reset时返回`true`；kill时返回`false`。该异常处理对用户不可见，仿真器内核自动消化。

!!! note
    对于一个已经terminated的线程，reset操作不生效，线程并不会再次执行。

*Example*:

```cpp
#include <systemc>
using namespace sc_core;
using namespace std;

struct M1 : sc_module {
  SC_HAS_PROCESS(M1);
  M1(sc_module_name name) : sc_module(name) {
    SC_THREAD(ticker); SC_THREAD(calling); SC_THREAD(target);
    t = sc_get_current_process_handle();
  }
  sc_process_handle t;
  sc_event ev;
  int count;
  void ticker() { for (;;) { wait(10, SC_NS); ev.notify(); } }
  void calling() {
    // Target runs at time 10 NS due to notification
    wait(15, SC_NS); sc_assert(count == 1);
    // Target runs again at time 20 NS due to notification
    wait(10, SC_NS); sc_assert(count == 2);
    // Target reset immediately at time 25 NS
    t.reset(); sc_assert(count == 0);
    // Target runs again at time 30 NS due to notification
    wait(10, SC_NS); sc_assert(count == 1);
    // Target killed immediately at time 35 NS
    t.kill(); sc_assert(t.terminated());
    sc_stop();
  }
  void target() {
    cout << "Target called/reset @" << sc_time_stamp() << endl;
    count = 0;
    for (;;) { wait(ev); cout << "Target awoke @" << sc_time_stamp() << endl; ++count; }
  }
};

int sc_main(int argc, char *argv[]) {
  M1 m1("m1");
  sc_start();
  return 0;
}
```
```bash title="Output"
Target called/reset @0 s
Target awoke @10 ns
Target awoke @20 ns
Target called/reset @25 ns
Target awoke @30 ns
```

### `sync_reset_on` and `sync_reset_off`

通过`sync_reset_on`进入*synchronous reset state*，之后通过`sync_reset_off`退出。

当某个线程处于*synchronous reset state*，每次响应notification或time-out时，对该线程执行reset操作。

*Example*:

```cpp
#include <systemc>
using namespace sc_core;
using namespace std;

struct M1 : sc_module {
  SC_HAS_PROCESS(M1);
  M1(sc_module_name name) : sc_module(name) {
    SC_THREAD(ticker); SC_THREAD(calling); SC_THREAD(target);
    t = sc_get_current_process_handle();
  }
  sc_process_handle t;
  sc_event ev;
  void ticker() { for (;;) { wait(10, SC_NS); ev.notify(); } }
  void calling() {
    // Target runs at time 10 NS due to notification
    wait(15, SC_NS);
    // Target does not run at time 15 NS
    t.sync_reset_on();
    // Target is reset at time 20 NS due to notification
    wait(10, SC_NS);
    // Target is reset again at time 30 NS due to notification
    wait(10, SC_NS);
    // Target does not run at time 35 NS
    t.sync_reset_off();
    // Target runs at time 40 NS due to notification
    wait(10, SC_NS);
    sc_stop();
  }
  void target() {
    cout << "Target called/reset @" << sc_time_stamp() << endl;
    for (;;) { wait(ev); cout << "Target awoke @" << sc_time_stamp() << endl; }
  }
};

int sc_main(int argc, char *argv[]) {
  M1 m1("m1");
  sc_start();
  return 0;
}
```
```bash title="Output"
Target called/reset @0 s
Target awoke @10 ns
Target called/reset @20 ns
Target called/reset @30 ns
Target awoke @40 ns
```

### `throw_it`

```cpp
template <typename T>
void throw_it(const T& user_defined_exception,
              sc_descendant_inclusion_info include_descendants = SC_NO_DESCENDANTS);
```

在某个线程中throw_it自身，立即产生对应的异常（第一个入参），用户需要实现异常捕获。

在某个线程中throw_it其他线程，将其从*runnable processes集合*中移除，清空所有动态敏感条件，并立即切换控制权到对应线程，恢复该线程执行。但是，恢复后立即产生对应的异常，用户需要在该线程中实现异常捕获。throw_it返回后控制权交还给caller线程。

!!! warning
    只能对非terminated的thread process使用throw_it。

*Example*:

```cpp
#include <systemc>
using namespace sc_core;
using namespace std;

struct Ex1 : exception {};
struct Ex2 : exception {};

struct M1 : sc_module {
  SC_HAS_PROCESS(M1);
  M1(sc_module_name name) : sc_module(name) {
    SC_THREAD(ticker); SC_THREAD(calling); SC_THREAD(target);
    t = sc_get_current_process_handle();
  }
  sc_process_handle t;
  sc_event ev;
  void ticker() { for (;;) { wait(10, SC_NS); ev.notify(); } }
  void calling() {
    // Target runs at time 10 NS due to notification
    // Target runs at time 15 NS due to throw
    wait(15, SC_NS); Ex1 ex1; t.throw_it(ex1);
    // Target runs at time 20 NS due to notification
    // Target runs at time 25 NS due to throw
    wait(10, SC_NS); Ex2 ex2; t.throw_it(ex2);
    // Target runs at time 30 NS due to notification
    // Target runs at time 35 NS due to throw, and then terminate
    wait(10, SC_NS); exception ex3; t.throw_it(ex3);
    // Target does not run at time 40 NS due to terminated
    wait(10, SC_NS);
    sc_stop();
  }
  void target() {
    for (;;) {
      try { wait(ev); cout << "Target awoke @" << sc_time_stamp() << endl;
      } catch (Ex1 const &e) { cout << "catch Ex1 @" << sc_time_stamp() << endl;
      } catch (Ex2 const &e) { cout << "catch Ex2 @" << sc_time_stamp() << endl;
      } catch (...) { cout << "terminate @" << sc_time_stamp() << endl; return; }
    }
  }
};

int sc_main(int argc, char *argv[]) {
  M1 m1("m1");
  sc_start();
  return 0;
}
```
```bash title="Output"
Target awoke @10 ns
catch Ex1 @15 ns
Target awoke @20 ns
catch Ex2 @25 ns
Target awoke @30 ns
terminate @35 ns
```

## `sc_get_current_process_handle`

按照被调用的阶段，返回的process对象handle如下：

- 在`sc_mudule`的构造函数，或者`before_end_of_elaboration`和`end_of_elaboration`的回调函数中调用时，返回最近一个被创建的process对象的handle。
- 在Simulation阶段调用时，返回当前正在被执行的process对象的handle。
- 其余场景可能返回invalid handle。

## `SC_METHOD` `SC_THREAD` and `SC_CTHREAD`

`SC_METHOD`, `SC_THREAD`和`SC_CTHREAD`这三个宏只能在`sc_module`中使用，分别用于创建method process，thread process，和cthread process。线程所绑定的函数必须是`sc_module`的成员函数，必须返回`void`，并且不能带任何入参（严格来讲，是不能带任何显式入参，非`static`的成员函数带有一个隐式`this`入 参）。

可以通过`sensitive`指定线程的静态敏感条件。

默认情况下，上述方式创建的线程（cthread process除外）会在Initialization Phase被添加到*runnable process集合*中。可以显示调用`dont_initialize`，避免在 Initialization Phase被添加到该集合中。

可以通过以下方式添加复位信号：

```cpp
// 同步复位
void reset_signal_is(const sc_in<bool>&, bool);
void reset_signal_is(const sc_inout<bool>&, bool);
void reset_signal_is(const sc_out<bool>&, bool);
void reset_signal_is(const sc_signal_in_if<bool>&, bool);
// 异步复位
void async_reset_signal_is(const sc_in<bool>&, bool);
void async_reset_signal_is(const sc_inout<bool>&, bool);
void async_reset_signal_is(const sc_out<bool>&, bool);
void async_reset_signal_is(const sc_signal_in_if<bool>&, bool);
```

第一个入参是复位信号，第二个入参是复位有效电平。

对于同步复位，复位信号有效时，线程进入*synchronous reset state*，复位信号无效时退出该状态。现实和`sc_process_handle`的`sync_reset_on`和`sync_reset_off`一致的效果。

对于异步复位，复位信号有效时，立刻复位该线程（`sc_process_handle`的`reset`操作），然后进入*synchronous reset state*。

对于同一个线程，上述函数可以多次叠加调用，同步和异步复位也可以混合调用。实现的效果是一个线程可以被多个信号复位。

## `sc_spawn` and `sc_spawn_options`

`sc_spawn`用于创建spawned process，通过`sc_spawn_options`配置该线程属性。

`sc_spawn`函数声明如下：

```cpp
template <typename T>
sc_process_handle sc_spawn(T object,
                           const char* name_p = 0,
                           const sc_spawn_options* opt_p = 0);

template <typename T>
sc_process_handle sc_spawn(typename T::result_type* r_p,
                           T object,
                           const char* name_p = 0,
                           const sc_spawn_options* opt_p = 0);
```

第一种形式用于创建没有返回值的线程（但是，允许绑定到带返回值的函数，只是返回值被丢弃），第二种形式用于创建带有返回值的线程。入参`const char* name_p`用于指定 线程名称。入参`const sc_spawn_options* opt_p`用于配置线程属性，默认值`0`表示使用下面`sc_spawn_options`类的默认值。

```cpp
class sc_spawn_options {
 public:
  sc_spawn_options();
  // 默认是thread process，调用spawn_method用于创建method process
  void spawn_method();
  // 默认在当前phase启动，调用后不在当前phase启动，需要指定静态敏感条件
  void dont_initialize();
  // 用于指定静态敏感条件，可以重复叠加调用
  void set_sensitivity(const sc_event*);
  void set_sensitivity(sc_port_base*);
  void set_sensitivity(sc_export_base*);
  void set_sensitivity(sc_interface*);
  void set_sensitivity(sc_event_finder*);
  // 同步复位信号
  void reset_signal_is(const sc_in<bool>&, bool);
  void reset_signal_is(const sc_inout<bool>&, bool);
  void reset_signal_is(const sc_out<bool>&, bool);
  void reset_signal_is(const sc_signal_in_if<bool>&, bool);
  // 异步复位信号
  void async_reset_signal_is(const sc_in<bool>&, bool);
  void async_reset_signal_is(const sc_inout<bool>&, bool);
  void async_reset_signal_is(const sc_out<bool>&, bool);
  void async_reset_signal_is(const sc_signal_in_if<bool>&, bool);
};
```

*Example*:

```cpp
#define SC_INCLUDE_DYNAMIC_PROCESSES  // needed for sc_spawn
#include <systemc>
using namespace sc_core;
using namespace std;

int f() { cout << "call f() at " << sc_time_stamp() << endl; return 123; }
struct Functor {
  typedef int result_type;
  result_type operator()() { return f(); }
};

struct MyMod : sc_module {
  SC_HAS_PROCESS(MyMod);
  MyMod(sc_module_name name) : sc_module(name) { SC_THREAD(T); }
  sc_event e;
  void T() {
    sc_spawn(f);  // 不带返回值的线程

    int ret = 0;
    Functor fr;
    sc_spawn(&ret, fr);  // 带返回值的线程，Functor内定义了result_type
    wait(1, SC_SEC);
    cout << "ret = " << ret << " at " << sc_time_stamp() << endl;

    ret = 0;
    sc_spawn(&ret, sc_bind(f)); // sc_bind返回类型内将函数f的返回类型定义为result_type
    wait(1, SC_SEC);
    cout << "ret = " << ret << " at " << sc_time_stamp() << endl;

    sc_spawn_options opt; opt.spawn_method(); opt.dont_initialize(); opt.set_sensitivity(&e);
    sc_spawn(f, "f", &opt); // 创建带静态敏感条件的method process
    e.notify(1, SC_SEC);
    wait(1, SC_SEC);

    sc_stop();
  }
};

int sc_main(int argc, char* argv[]) {
  MyMod m("m");
  sc_start();
  return 0;
}
```
```bash title="Output"
call f() at 0 s
call f() at 0 s
ret = 123 at 1 s
call f() at 1 s
ret = 123 at 2 s
call f() at 3 s
```

通过sc_bind还可以实现带入参的线程。

*Example*:

```cpp
#define SC_INCLUDE_DYNAMIC_PROCESSES  // needed for sc_spawn
#include <systemc>
using namespace sc_core;
using namespace std;

struct MyMod : sc_module {
  SC_HAS_PROCESS(MyMod);
  sc_event e1;
  sc_event e2;

  MyMod(sc_module_name name) : sc_module(name), e1("e1"), e2("e2") {
    sc_spawn(sc_bind(&MyMod::T, this, sc_ref(e1)));
    sc_spawn(sc_bind(&MyMod::T, this, sc_ref(e2)));
    SC_THREAD(trigger);
  }

  void T(sc_event& e) {
    while (true) {
      wait(e);
      cout << "call T(), triggered by " << e.name() << " at " << sc_time_stamp() << endl;
    }
  }
  void trigger() {
    e1.notify(); wait(1, SC_SEC);
    e2.notify(); wait(1, SC_SEC);
    sc_stop();
  }
};

int sc_main(int argc, char* argv[]) {
  MyMod m("m");
  sc_start();
  return 0;
}
```
```bash title="Output"
call T(), triggered by m.e1 at 0 s
call T(), triggered by m.e2 at 1 s
```

`sc_ref`用于传递reference类型，此外还有`sc_cref`用于传递const reference类型。

## `SC_FORK` and `SC_JOIN`

通过`SC_FORK SC_JOIN`可以实现类似SV的`fork join`，使用方式如下：

```cpp
SC_FORK
  sc_spawn(arguments),
  sc_spawn(arguments),
  sc_spawn(arguments)
SC_JOIN
```

!!! warning
    `SC_FORK SC_JOIN`不能在method process中使用，并且，其中通过`sc_spawn`创建的线程也不能是method process。

不过，SC中并没有直接定义类似SV的`fork join_none`和`fork join_any`，但是用户实现起来也不复杂。调用`sc_spawn`创建线程的操作本身并不会阻塞调用者的线程，因此天然是join_none的。对于join_any，借助`sc_process_handle`的`terminated_event`和`sc_event_or_list`可以很容易实现。

```cpp
#define SC_INCLUDE_DYNAMIC_PROCESSES  // needed for sc_spawn
#include <systemc>
using namespace sc_core;
using namespace std;

struct MyMod : sc_module {
  SC_HAS_PROCESS(MyMod);
  MyMod(sc_module_name name) : sc_module(name) { SC_THREAD(T); }
  void T() {
    sc_process_handle h1 = sc_spawn(sc_bind(&MyMod::t, this, 1));
    sc_process_handle h2 = sc_spawn(sc_bind(&MyMod::t, this, 2));
    sc_event_or_list e;
    e |= h1.terminated_event();
    e |= h2.terminated_event();
    wait(e);
    cout << "join_any at " << sc_time_stamp() << endl;
  }
  void t(int n) {
    wait(n, SC_SEC);
    cout << "call t(" << n << ") at " << sc_time_stamp() << endl;
  }
};

int sc_main(int argc, char* argv[]) {
  MyMod m("m");
  sc_start();
  return 0;
}
```
```bash title="Output"
call t(1) at 1 s
join_any at 1 s
call t(2) at 2 s
```

其实，不使用`SC_FORK SC_JOIN`，通过`sc_event_and_list`也很容易实现线程join。

```cpp
#define SC_INCLUDE_DYNAMIC_PROCESSES  // needed for sc_spawn
#include <systemc>
using namespace sc_core;
using namespace std;

struct MyMod : sc_module {
  SC_HAS_PROCESS(MyMod);
  MyMod(sc_module_name name) : sc_module(name) { SC_THREAD(T); }
  void T() {
    sc_process_handle h1 = sc_spawn(sc_bind(&MyMod::t, this, 1));
    sc_process_handle h2 = sc_spawn(sc_bind(&MyMod::t, this, 2));
    sc_event_and_list e;
    e &= h1.terminated_event();
    e &= h2.terminated_event();
    wait(e);
    cout << "join at " << sc_time_stamp() << endl;
  }
  void t(int n) {
    wait(n, SC_SEC);
    cout << "call t(" << n << ") at " << sc_time_stamp() << endl;
  }
};

int sc_main(int argc, char* argv[]) {
  MyMod m("m");
  sc_start();
  return 0;
}
```
```bash title="Output"
call t(1) at 1 s
call t(2) at 2 s
join at 2 s
```

## `wait` and `next_trigger`

总结`wait`和`next_trigger`支持的形式，分别用于thread process和method process。

```cpp
// wait静态敏感条件
void wait();
void wait(int n); // 相当于连续n次调用wait()
// wait event
void wait(const sc_event&);
void wait(const sc_event_or_list&);
void wait(const sc_event_and_list&);
// wait time-out
void wait(const sc_time&);
void wait(double v, sc_time_unit tu); // 相当于调用wait(sc_time(v, tu))
// wait time-out或者event，只要其中一个满足就结束wait
void wait(const sc_time&, const sc_event&);
void wait(double, sc_time_unit, const sc_event&);
void wait(const sc_time&, const sc_event_or_list&);
void wait(double, sc_time_unit, const sc_event_or_list&);
void wait(const sc_time&, const sc_event_and_list&);
void wait(double, sc_time_unit, const sc_event_and_list&);

// 被静态敏感条件trigger
void next_trigger();
// 被event trigger
void next_trigger(const sc_event&);
void next_trigger(const sc_event_or_list&);
void next_trigger(const sc_event_and_list&);
// 被time-out trigger
void next_trigger(const sc_time&);
void next_trigger(double v, sc_time_unit tu);  // 相当于调用next_trigger(sc_time(v, tu))
// 被time-out或者event trigger，只要其中一个满足就能trigger
void next_trigger(const sc_time&, const sc_event&);
void next_trigger(double, sc_time_unit, const sc_event&);
void next_trigger(const sc_time&, const sc_event_or_list&);
void next_trigger(double, sc_time_unit, const sc_event_or_list&);
void next_trigger(const sc_time&, const sc_event_and_list&);
void next_trigger(double, sc_time_unit, const sc_event_and_list&);
```
